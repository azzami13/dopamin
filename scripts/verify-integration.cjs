const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { transformSync } = require('esbuild'); // Installed through tsx/drizzle-kit.
const crypto = require('node:crypto');
const { PgDialect } = require('drizzle-orm/pg-core');

function loadTs(file, overrides = {}) {
  const module = { exports: {} };
  const code = transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
  vm.runInNewContext(code, { module, exports: module.exports, require: (name) => name in overrides ? overrides[name] : require(name), Buffer, console }, { filename: file });
  return module.exports;
}

const authorization = loadTs('src/lib/auth/authorization.ts', {
  'next/navigation': {}, '@/auth': {}, './identity-context': {},
});
function salesService(execute) {
  return loadTs('src/modules/sales/sales-query.service.ts', {
    '@/db/client': { db: { execute } }, '@/lib/auth/authorization': authorization,
    '@/lib/auth/permissions': { Permission: { SALES_VIEW: 'SALES_VIEW' } },
    '@/lib/http/api': { appError: (message, status) => Object.assign(new Error(message), { status }) },
  });
}

async function main() {
  const hmac = loadTs('src/lib/integration/hmac.ts');
  const signed = { body: '{"payload":{}}', timestamp: '1000', secret: 'test-only-secret', now: 1000 };
  signed.signature = 'sha256=' + hmac.signBody(signed.body, signed.timestamp, signed.secret);
  assert.equal(hmac.verifySignedRequest(signed), true);
  for (const change of [{ body: '{}' }, { timestamp: '1000.5' }, { signature: null }, { now: 1301 }, { now: 699 }, { secret: '' }]) assert.equal(hmac.verifySignedRequest({ ...signed, ...change }), false);

  const dialect = new PgDialect();
  for (const [role, types, own] of [['OWNER', ['FOOD', 'BEVERAGE'], false], ['DIRECTOR', ['FOOD', 'BEVERAGE'], false], ['MANAGER', ['FOOD', 'BEVERAGE'], false], ['KITCHEN', ['FOOD'], true], ['CASHIER', ['BEVERAGE'], true]]) {
    const queries = [];
    const service = salesService(async (query) => { queries.push(dialect.sqlToQuery(query)); return []; });
    const actor = { role, userId: '00000000-0000-0000-0000-000000000001', permissions: ['SALES_VIEW'] };
    const result = await service.getSalesOverview(actor, '2099-01-02', '2099-01-01');
    assert.equal(result.reports.length, 0);
    assert.equal(queries.length, 3);
    for (const query of queries) {
      assert.match(query.sql, /sr\.report_type in \(\$3(?:, \$4)?\)/);
      assert.equal(query.sql.includes('::text[]'), false);
      assert.deepEqual(query.params.slice(2, 2 + types.length), types);
      assert.equal(query.params.at(-2), !own);
      assert.equal(query.params.at(-1), actor.userId);
    }
    await assert.rejects(() => service.getSalesOverview({ ...actor, permissions: [] }, '2099-01-02', '2099-01-01'), { status: 403 });
  }

  const propsMap = new Map(Object.entries({ DOPAMIN_SOURCE_KEY: 'CASHIER', DOPAMIN_SPREADSHEET_ID: 'test-sheet', DOPAMIN_SHEET_ID: '42', DOPAMIN_BASE_URL: 'https://example.invalid', DOPAMIN_INTEGRATION_SECRET: 'test-only-secret', DOPAMIN_REPLAY_ROWS: '2' }));
  const props = { getProperty: (key) => propsMap.get(key), setProperty: (key, value) => propsMap.set(key, value) };
  let headers = ['Timestamp', 'Tanggal Pelaporan', 'Pembayaran Cash'];
  const values = [new Date('2026-09-09T05:00:00Z'), new Date('2026-09-08T17:00:00Z'), 25000];
  const sheet = { getParent: () => spreadsheet, getSheetId: () => 42, getName: () => 'Test only', getLastRow: () => 4, getLastColumn: () => headers.length, getRange: () => ({ getValues: () => [values], getDisplayValues: () => [headers] }) };
  const spreadsheet = { getId: () => 'test-sheet', getSheets: () => [sheet] };
  const sent = [];
  let statuses = [];
  const context = {
    Date, PropertiesService: { getScriptProperties: () => props }, SpreadsheetApp: { openById: () => spreadsheet },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: { Charset: { UTF_8: 'utf8' }, sleep() {}, formatDate: (date, zone, format) => {
      assert.equal(zone, 'Asia/Jakarta');
      const local = new Date(date.getTime() + 7 * 3600000).toISOString();
      return format === 'yyyy-MM-dd' ? local.slice(0, 10) : local.slice(0, 19) + '+07:00';
    }, computeHmacSha256Signature: (body, secret) => [...crypto.createHmac('sha256', secret).update(body).digest()] },
    UrlFetchApp: { fetch: (url, options) => {
      const timestamp = options.headers['X-Dopamin-Timestamp'];
      assert.equal(options.headers['X-Dopamin-Signature'], 'sha256=' + hmac.signBody(options.payload, timestamp, 'test-only-secret'));
      sent.push(JSON.parse(options.payload));
      const status = statuses.shift() ?? 201;
      return { getResponseCode: () => status, getContentText: () => JSON.stringify({ ok: true, data: { status: 'NEEDS_REVIEW' } }) };
    } },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('integrations/google-apps-script/Code.gs', 'utf8'), context);
  context.onFormSubmit({ range: { getSheet: () => sheet, getRow: () => 2 }, namedValues: { 'Pembayaran Cash': ['25.000'] } });
  context.sendRow_(sheet, 2);
  assert.deepEqual(sent[0].payload, sent[1].payload);
  assert.equal(sent[0].payload['Tanggal Pelaporan'], '2026-09-09');
  assert.equal(sent[0].rowKey, sent[1].rowKey);
  headers = ['Timestamp', 'Timestamp', 'Cash'];
  assert.throws(() => context.sendRow_(sheet, 2), /duplicate/);
  headers = ['Timestamp', 'Tanggal Pelaporan', 'Pembayaran Cash'];
  statuses = [500, 201];
  const count = sent.length;
  context.sendRow_(sheet, 2);
  assert.equal(sent.length - count, 2);
  statuses = [401];
  assert.throws(() => context.backfillRows(), /HTTP 401/);
  const cursor = 'DOPAMIN_BACKFILL_NEXT_ROW_CASHIER_test-sheet_42';
  assert.equal(propsMap.has(cursor), false);
  context.backfillRows();
  assert.equal(propsMap.get(cursor), '4');
  context.backfillRows();
  assert.equal(propsMap.get(cursor), '5');
  console.log('PASS: sales SQL/role scope, HMAC, live/replay payload parity, date serialization, header validation, retry and backfill cursor.');
}

if (require.main === module) main().catch((error) => { console.error('INTEGRATION REGRESSION FAILED', error); process.exitCode = 1; });
module.exports = { salesService };
