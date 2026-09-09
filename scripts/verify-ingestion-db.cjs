// Synthetic fixtures run inside one transaction that ALWAYS rolls back.
require('dotenv/config');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { transformSync } = require('esbuild');
const { randomUUID } = require('node:crypto');
const postgres = require('postgres');
const { drizzle } = require('drizzle-orm/postgres-js');
const { eq, and, sql } = require('drizzle-orm');
const client = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connection: { application_name: 'dopamin-rollback-regression', idle_in_transaction_session_timeout: 10000 } });
// Services borrow this test-owned transaction; they cannot commit fixtures.
let connection;
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const localRequire = (name) => {
    if (name === '@/db/client') return { db: new Proxy({}, { get: (_, key) => key === 'transaction' ? (callback) => callback(connection) : typeof connection[key] === 'function' ? connection[key].bind(connection) : connection[key] }) };
    if (name === '@/auth') return {};
    if (name === 'next/navigation') return {};
    if (name.startsWith('@/') || name.startsWith('.')) {
      let target = name.startsWith('@/') ? path.resolve('src', name.slice(2)) : path.resolve(path.dirname(file), name);
      target = fs.existsSync(target + '.ts') ? target + '.ts' : path.join(target, 'index.ts');
      return load(target);
    }
    return require(name);
  };
  const code = transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
  new Function('require', 'module', 'exports', code)(localRequire, module, module.exports);
  return module.exports;
}

async function main() {
  const schema = load('src/db/schema/index.ts');
  const db = drizzle(client, { schema });
  const { ingestGoogleForm } = load('src/modules/integration/ingestion.service.ts');
  const { reprocessSubmission } = load('src/modules/integration/reprocess.service.ts');
  const rollback = new Error('ROLLBACK_TEST_FIXTURES');
  try {
    try {
      await db.transaction(async (tx) => {
        connection = tx;
        await tx.execute(sql`set local statement_timeout = '20s'`);
        await tx.execute(sql`set local idle_in_transaction_session_timeout = '10s'`);
        const [owner] = await tx.execute(sql`select u.id from users u join roles r on r.id=u.role_id where r.code='OWNER' and r.is_active and u.is_active limit 1`);
        assert.ok(owner);
        const actor = { userId: owner.id, role: 'OWNER', permissions: ['SETTINGS_MANAGE', 'CORRECTION_CREATE'] };
        const [source] = await tx.select().from(schema.dataSources).where(eq(schema.dataSources.code, 'CASHIER'));
        const key = 'test-' + randomUUID();
        const envelope = { sourceKey: 'CASHIER', spreadsheetId: source.spreadsheetId || undefined, sheetName: source.sheetName || undefined, rowKey: key, submittedAt: '2099-01-01T12:00:00+07:00', payload: { 'Tanggal Pelaporan': '2099-01-01', [key]: 12000 } };
        console.log('Checking initial ingestion...');
        const first = await ingestGoogleForm(envelope, key);
        assert.equal(first.status, 'NEEDS_REVIEW');
        const replay = await ingestGoogleForm(envelope, key);
        assert.equal(replay.idempotent, true);
        assert.equal(replay.rawSubmissionId, first.rawSubmissionId);
        await assert.rejects(() => reprocessSubmission({ ...actor, permissions: [] }, first.rawSubmissionId, 'test'), { status: 403 });
        await tx.insert(schema.sourceFieldMappings).values({ dataSourceId: source.id, sourceFieldName: key, mappingType: 'PAYMENT', targetKey: 'CASH' });
        console.log('Checking mapping reprocess...');
        const rebuilt = await reprocessSubmission(actor, first.rawSubmissionId, 'Rollback-only mapping regression');
        assert.equal(rebuilt.status, 'VALID');
        const [raw] = await tx.select().from(schema.rawSubmissions).where(eq(schema.rawSubmissions.id, first.rawSubmissionId));
        assert.deepEqual(raw.rawPayload, envelope.payload);
        console.log('Checking revision replacement...');
        const changed = await ingestGoogleForm({ ...envelope, payload: { ...envelope.payload, [key]: 15000 } }, key);
        assert.equal(changed.revision, 2);
        const [oldReport] = await tx.select().from(schema.cashierReports).where(eq(schema.cashierReports.sourceSubmissionId, first.rawSubmissionId));
        assert.equal(oldReport.reportStatus, 'SUPERSEDED');
        const [oldRaw] = await tx.select().from(schema.rawSubmissions).where(eq(schema.rawSubmissions.id, first.rawSubmissionId));
        assert.deepEqual(oldRaw.rawPayload, envelope.payload);
        console.log('Checking obsolete revision guard...');
        await assert.rejects(() => reprocessSubmission(actor, first.rawSubmissionId, 'test'), { status: 409 });
        console.log('Obsolete revision guard passed.');
        // Oversized identity triggers a database normalization failure after raw persistence.
        console.log('Checking normalization failure...');
        const failed = await ingestGoogleForm({ ...envelope, payload: { ...envelope.payload, [key]: 16000, Cashier: 'x'.repeat(200) } }, key);
        assert.equal(failed.status, 'ERROR');
        const [failedRaw] = await tx.select().from(schema.rawSubmissions).where(eq(schema.rawSubmissions.id, failed.rawSubmissionId));
        assert.equal(failedRaw.rawPayload.Cashier.length, 200);
        const [retained] = await tx.select().from(schema.cashierReports).where(eq(schema.cashierReports.sourceSubmissionId, changed.rawSubmissionId));
        assert.equal(retained.reportStatus, 'NEEDS_REVIEW');
        const partial = await tx.select().from(schema.cashierReports).where(eq(schema.cashierReports.sourceSubmissionId, failed.rawSubmissionId));
        assert.equal(partial.length, 0);
        const audit = await tx.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.entityId, first.rawSubmissionId), eq(schema.auditLogs.action, 'REPROCESS')));
        assert.equal(audit.length, 1);
        console.log('PASS: idempotent replay, mapping reprocess, RBAC denial, changed-row supersession, raw retention, failure savepoint, review-only previous report, reprocess audit. Rolling back all fixtures.');
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
  } finally { await client.end(); }
}
const watchdog = setTimeout(() => { console.error('INGESTION DB REGRESSION TIMEOUT'); process.exit(1); }, 180000);
main().finally(() => clearTimeout(watchdog)).catch((error) => { console.error('INGESTION DB REGRESSION FAILED:', error.code || error.name, error.message, error.cause?.code || ''); process.exitCode = 1; });
