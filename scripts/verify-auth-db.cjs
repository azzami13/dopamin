// Test-only synthetic user; all writes, including audit events, always roll back.
require('dotenv/config');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { transformSync } = require('esbuild');
const { randomUUID } = require('node:crypto');
const postgres = require('postgres');
const { drizzle } = require('drizzle-orm/postgres-js');
const { eq, sql } = require('drizzle-orm');
const client = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connection: { application_name: 'dopamin-auth-rollback-test', idle_in_transaction_session_timeout: 15000 } });
let connection;
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const localRequire = name => {
    if (name === '@/db/client') return { db: new Proxy({}, { get: (_, key) => key === 'transaction' ? callback => callback(connection) : typeof connection[key] === 'function' ? connection[key].bind(connection) : connection[key] }) };
    if (name.startsWith('@/') || name.startsWith('.')) {
      let target = name.startsWith('@/') ? path.resolve('src', name.slice(2)) : path.resolve(path.dirname(file), name);
      return load(fs.existsSync(target + '.ts') ? target + '.ts' : path.join(target, 'index.ts'));
    }
    return require(name);
  };
  new Function('require', 'module', 'exports', transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs' }).code)(localRequire, module, module.exports);
  return module.exports;
}
async function main() {
  const schema = load('src/db/schema/index.ts');
  const db = drizzle(client, { schema });
  const passwords = load('src/lib/auth/password.ts');
  const service = load('src/lib/auth/password-service.ts');
  const access = load('src/modules/settings/access-request.service.ts');
  const rollback = new Error('TEST_ROLLBACK');
  const id = randomUUID(), email = `auth-test-${id}@example.invalid`;
  try {
    await db.transaction(async tx => {
      connection = tx;
      const [role] = await tx.select({ id: schema.roles.id }).from(schema.roles).where(eq(schema.roles.code, 'OWNER'));
      const sample = 'Fixture-Only-2026!', replacement = 'Replacement-Only-2026!';
      await tx.insert(schema.users).values({ id, roleId: role.id, email, fullName: 'Rollback fixture', passwordHash: await passwords.hashPassword(sample), passwordUpdatedAt: new Date(), mustChangePassword: true });
      const state = async () => (await tx.select().from(schema.users).where(eq(schema.users.id, id)))[0];
      for (let i = 1; i <= 5; i++) { assert.equal(await service.authenticatePassword(email, 'wrong'), null); assert.equal((await state()).failedLoginAttempts, i); }
      assert.ok((await state()).lockedUntil > new Date());
      assert.equal(await service.authenticatePassword(email, sample), null);
      await tx.update(schema.users).set({ lockedUntil: new Date(Date.now() - 1000) }).where(eq(schema.users.id, id));
      assert.equal(await service.authenticatePassword(email, 'wrong'), null);
      assert.equal((await state()).failedLoginAttempts, 1);
      const login = await service.authenticatePassword(email.toUpperCase(), sample);
      assert.ok(login);
      assert.deepEqual(Object.keys(login).sort(), ['credentialVersion', 'email', 'id', 'name']);
      assert.equal((await state()).failedLoginAttempts, 0);
      assert.equal(await service.credentialSessionIsCurrent(email, login.credentialVersion), true);
      assert.equal(await service.changePassword(id, 'wrong', replacement), 'INVALID');
      assert.equal((await state()).failedLoginAttempts, 1);
      assert.equal(await service.changePassword(id, sample, sample), 'POLICY');
      assert.equal(await service.changePassword(id, sample, replacement), 'OK');
      assert.equal((await state()).mustChangePassword, false);
      assert.equal(await service.credentialSessionIsCurrent(email, login.credentialVersion), false);
      assert.equal(await service.authenticatePassword(email, sample), null);
      assert.ok(await service.authenticatePassword(email, replacement));
      const [audit] = await tx.select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId, id));
      assert.equal(audit.action, 'PASSWORD_CHANGED');
      assert.equal(audit.beforeData, null); assert.equal(audit.afterData, null);
      await tx.update(schema.users).set({ isActive: false }).where(eq(schema.users.id, id));
      assert.equal(await service.authenticatePassword(email, replacement), null);
      await tx.update(schema.users).set({ isActive: true, passwordHash: null }).where(eq(schema.users.id, id));
      assert.equal(await service.authenticatePassword(email, replacement), null);
      const reviewer = { userId: id, role: 'OWNER', permissions: [], mustChangePassword: false };
      const candidateEmail = `access-${id}@example.invalid`;
      assert.equal(await access.requestGoogleAccess('  ' + candidateEmail.toUpperCase() + '  ', 'Google fixture'), 'PENDING');
      assert.equal(await access.requestGoogleAccess(candidateEmail, 'Updated Google fixture'), 'PENDING');
      let requests = await tx.select().from(schema.accessRequests).where(eq(schema.accessRequests.email, candidateEmail));
      assert.equal(requests.length, 1);
      assert.equal(requests[0].fullName, 'Updated Google fixture');
      assert.equal((await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, candidateEmail))).length, 0);
      for (const deniedRole of ['MANAGER', 'CASHIER', 'KITCHEN']) {
        await assert.rejects(access.listAccessRequests({ ...reviewer, role: deniedRole }), { status: 403 });
        await assert.rejects(access.reviewAccessRequest({ ...reviewer, role: deniedRole }, { id: requests[0].id, decision: 'REJECTED' }), { status: 403 });
      }
      await assert.rejects(access.reviewAccessRequest(reviewer, { id: requests[0].id, decision: 'APPROVED' }), { status: 422 });
      await access.reviewAccessRequest(reviewer, { id: requests[0].id, decision: 'APPROVED', roleId: role.id });
      const [approvedUser] = await tx.select().from(schema.users).where(eq(schema.users.email, candidateEmail));
      assert.equal(approvedUser.passwordHash, null);
      assert.equal(approvedUser.fullName, 'Updated Google fixture');
      assert.equal(approvedUser.roleId, role.id);
      assert.equal(approvedUser.mustChangePassword, false);
      const identity = load('src/lib/auth/identity-context.ts');
      assert.ok(await identity.findActiveActorByEmail(' ' + candidateEmail.toUpperCase() + ' '));
      assert.equal(await access.requestGoogleAccess(candidateEmail, 'Ignore new name'), 'EXISTING');
      await assert.rejects(access.reviewAccessRequest(reviewer, { id: requests[0].id, decision: 'REJECTED' }), { status: 409 });
      const rejectedEmail = `rejected-${id}@example.invalid`;
      await access.requestGoogleAccess(rejectedEmail, 'Rejected fixture');
      const [rejected] = await tx.select().from(schema.accessRequests).where(eq(schema.accessRequests.email, rejectedEmail));
      await access.reviewAccessRequest(reviewer, { id: rejected.id, decision: 'REJECTED' });
      assert.equal((await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, rejectedEmail))).length, 0);
      assert.equal((await tx.select().from(schema.accessRequests).where(eq(schema.accessRequests.id, rejected.id)))[0].status, 'REJECTED');
      const duplicate = await tx.insert(schema.users).values({ email: ' ' + candidateEmail.toUpperCase() + ' ', fullName: 'Duplicate fixture', roleId: role.id }).onConflictDoNothing().returning({ id: schema.users.id });
      assert.equal(duplicate.length, 0);
      const [directorRole] = await tx.select({ id: schema.roles.id }).from(schema.roles).where(eq(schema.roles.code, 'DIRECTOR'));
      await tx.update(schema.users).set({ roleId: directorRole.id }).where(eq(schema.users.id, id));
      await access.requestGoogleAccess(rejectedEmail, 'New request after rejection');
      const [pendingAgain] = (await access.listAccessRequests({ ...reviewer, role: 'DIRECTOR' })).requests.filter(r => r.email === rejectedEmail);
      await access.reviewAccessRequest({ ...reviewer, role: 'DIRECTOR' }, { id: pendingAgain.id, decision: 'APPROVED', roleId: role.id });
      console.log('ACCESS REQUEST DB REGRESSION PASSED: pending deduplication, Owner/Director approval, role enforcement, rejection, Google identity and normalized uniqueness.');
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
  assert.equal((await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, id))).length, 0);
  console.log('AUTH DB REGRESSION PASSED; synthetic user and audit rolled back.');
}
const timeout = setTimeout(() => { console.error('AUTH DB TEST TIMED OUT'); process.exit(1); }, 300000);
main().catch(() => { console.error('AUTH DB REGRESSION FAILED'); process.exitCode = 1; }).finally(async () => { await client.end(); clearTimeout(timeout); });
