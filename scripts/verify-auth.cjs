const assert = require('node:assert/strict');
const fs = require('node:fs');
const { transformSync } = require('esbuild');
function load(file, overrides = {}) {
  const module = { exports: {} };
  const code = transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs' }).code;
  new Function('require', 'module', 'exports', code)(name => name in overrides ? overrides[name] : require(name), module, module.exports);
  return module.exports;
}
async function main() {
  const password = load('src/lib/auth/password.ts');
  const sample = 'Fixture-Only-2026!';
  for (const invalid of ['shortA1!', 'alllowercase1!', 'ALLUPPERCASE1!', 'NoNumbersHere!', 'NoSymbolsHere123', 'Aa1!' + 'é'.repeat(35), null]) assert.equal(password.validPassword(invalid), false);
  assert.equal(password.validPassword(sample), true);
  const hash = await password.hashPassword(sample);
  assert.equal(await password.verifyPassword(sample, hash), true);
  assert.equal(await password.verifyPassword('wrong', hash), false);
  assert.equal(await password.verifyPassword(sample, null), false);
  const now = new Date();
  let state = { failedLoginAttempts: 0, lockedUntil: null };
  for (let i = 1; i <= 5; i++) {
    state = password.failedAttempt(state, now);
    assert.equal(state.failedLoginAttempts, i);
    assert.equal(Boolean(state.lockedUntil), i === 5);
  }
  assert.equal(state.lockedUntil.getTime() - now.getTime(), 900000);
  assert.equal(password.failedAttempt(state, new Date(now.getTime() + 900001)).failedLoginAttempts, 1);
  let config;
  let actor = { userId: 'fixture', fullName: 'Fixture', mustChangePassword: true };
  let current = true;
  let requestResult = 'PENDING';
  const accessCalls = [];
  load('src/auth.ts', {
    'next-auth': options => { config = options; return {}; },
    'next-auth/providers/google': options => ({ id: 'google', ...options }),
    'next-auth/providers/credentials': options => ({ id: 'credentials', ...options }),
    '@/lib/auth/password-service': { authenticatePassword: async () => null, credentialSessionIsCurrent: async () => current },
    '@/lib/auth/identity-context': { findActiveActorByEmail: async () => actor },
    '@/modules/settings/access-request.service': { requestGoogleAccess: async (...args) => { accessCalls.push(args); if (requestResult === 'ERROR') throw new Error('private'); return requestResult; } },
  });
  assert.deepEqual(config.providers.map(p => p.id), ['google', 'credentials']);
  assert.equal(config.pages.error, '/auth-error');
  assert.equal(await config.callbacks.signIn({ user: { email: 'fixture@example.invalid' }, account: { provider: 'google' } }), true);
  assert.equal(await config.callbacks.signIn({ user: { email: 'fixture@example.invalid' } }), true);
  const session = await config.callbacks.session({ session: { user: { email: 'fixture@example.invalid' } } });
  assert.deepEqual(Object.keys(session.user).sort(), ['email', 'name']);
  actor = null;
  assert.equal(accessCalls.length, 0);
  const unknownGoogle = { user: { email: 'fixture@example.invalid', name: 'Google Fixture' }, account: { provider: 'google' }, profile: { email_verified: true } };
  assert.equal(await config.callbacks.signIn(unknownGoogle), '/access-pending?status=pending');
  assert.deepEqual(accessCalls[0], ['fixture@example.invalid', 'Google Fixture']);
  assert.equal(await config.callbacks.signIn({ ...unknownGoogle, profile: { email_verified: false } }), '/auth-error');
  assert.equal(accessCalls.length, 1);
  requestResult = 'EXISTING';
  assert.equal(await config.callbacks.signIn(unknownGoogle), '/access-pending');
  requestResult = 'ERROR';
  assert.equal(await config.callbacks.signIn(unknownGoogle), '/auth-error');
  assert.equal(await config.callbacks.signIn({ user: {}, account: { provider: 'google' } }), '/access-pending');
  assert.equal(await config.callbacks.signIn({ user: { email: 'fixture@example.invalid' }, account: { provider: 'credentials' } }), false);
  assert.equal(await config.callbacks.signIn({ user: { email: 'fixture@example.invalid' } }), false);
  current = false;
  assert.equal(await config.callbacks.jwt({ token: { email: 'fixture@example.invalid', loginMethod: 'credentials' } }), null);
  assert.ok(await config.callbacks.jwt({ token: { email: 'fixture@example.invalid', loginMethod: 'google' } }));
  actor = { userId: 'fixture', mustChangePassword: true };
  const authorization = load('src/lib/auth/authorization.ts', {
    '@/auth': { auth: async () => ({ user: { email: 'fixture@example.invalid' } }) },
    './identity-context': { findActiveActorByEmail: async () => actor },
    'next/navigation': { redirect: url => { throw new Error(url); } },
  });
  assert.equal(await authorization.getCurrentActor(), null);
  assert.equal(await authorization.getCurrentActor({ allowPasswordChange: true }), actor);
  await assert.rejects(authorization.requireActor(), { message: '/change-password' });
  const calls = [];
  const route = load('src/app/api/auth/change-password/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/auth/authorization': { getCurrentActor: async () => actor },
    '@/lib/auth/password': password,
    '@/lib/auth/password-service': { changePassword: async (...args) => { calls.push(args); return 'INVALID'; } },
  });
  const request = origin => new Request('https://cafe.example/api/auth/change-password', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ userId: 'attacker-target', currentPassword: 'wrong', newPassword: sample, confirmPassword: sample }) });
  assert.equal((await route.POST(request('https://other.example'))).status, 403);
  assert.equal(calls.length, 0);
  const response = await route.POST(request('https://cafe.example'));
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).error.message, password.LOGIN_ERROR);
  assert.equal(calls[0][0], actor.userId);
  actor = null;
  assert.equal((await route.POST(request('https://cafe.example'))).status, 401);
  class AuthError extends Error {}
  const redirects = [];
  const oauthCalls = [];
  let oauthError;
  const googleActions = load('src/app/(auth)/login/google-actions.ts', {
    'next-auth': { AuthError },
    'next/navigation': { redirect: url => { redirects.push(url); throw new Error('REDIRECT'); } },
    '@/auth': { signIn: async (...args) => { oauthCalls.push(args); if (oauthError) throw oauthError; } },
  });
  await googleActions.googleLoginWithAnotherAccount();
  assert.deepEqual(oauthCalls[0], ['google', { redirectTo: '/dashboard' }, { prompt: 'select_account' }]);
  await googleActions.googleLogin();
  assert.equal(oauthCalls[1][2], undefined);
  oauthError = new AuthError('internal test detail');
  await assert.rejects(googleActions.googleLogin(), { message: 'REDIRECT' });
  assert.deepEqual(redirects, ['/auth-error']);
  oauthError = new Error('NEXT_REDIRECT');
  await assert.rejects(googleActions.googleLogin(), { message: 'NEXT_REDIRECT' });
  console.log('AUTH REGRESSION PASSED: policy, bcrypt, lock expiry, Google allowlist, session invalidation, forced change and endpoint protection.');
}
main().catch(() => { console.error('AUTH REGRESSION FAILED'); process.exitCode = 1; });
