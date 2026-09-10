# Google and password login

Google OAuth remains enabled with the existing registered-email, active-user, active-role and PostgreSQL RBAC checks. Credentials uses the same `users` table. There is no public signup or password reset endpoint.

## Google access requests

Apply `npm run db:access-requests` before deploying the access-request flow to an existing database. Migration `0004_access_requests.sql` creates the request table and adds unique `lower(trim(email))` user identity enforcement. It aborts with a clear message if existing normalized user emails are duplicated; resolve those identities explicitly before retrying. It does not merge or rewrite users. Fresh bootstrap includes this migration automatically.

A verified Google login for an unknown email creates or updates one PENDING request and redirects to `/access-pending?status=pending`. This does not create a user or session. Existing inactive users are not reactivated or submitted as new users. Their account must be managed separately. Unknown unverified Google identities and infrastructure failures use the safe auth-error page.

Owner/Director can review pending requests in Settings. Approval requires an active role and atomically creates the user without a password, records the reviewer/role/time, and appends an audit event. Rejection records REJECTED without creating a user. A later Google login after rejection can submit a new request; prior review history remains. An already reviewed request cannot be reviewed again. Approval refuses an email that has become an existing user, rather than changing its access. The approved user can retry Google login normally.

The Settings API is `/api/settings/access-requests` (GET pending list/roles; POST decision). It requires authentication and server-side OWNER/DIRECTOR role checks; mutations also recheck the reviewer in the transaction and require same-origin requests. There is no public request-creation endpoint. Credentials lookups now use the same normalized-email expression, retaining lockout, generic errors and mandatory-password-change behavior.

## Deployment and account setup

Install locked dependencies with `npm ci`. Apply the additive migration to an existing database before starting this version:

```powershell
npm run db:dual-login
npm run db:smoke
npm run user:set-password -- --email user@example.com
```

`db:dual-login` applies only `0003_dual_login.sql` in a transaction, refuses partial migrations and skips an already present set of five columns. Do not bootstrap an existing database. Fresh database bootstrap already discovers this migration in filename order. The password script uses `DATABASE_MIGRATION_URL`, falling back to `DATABASE_URL`, and only updates an existing active user with an active role.

Enter and confirm the password in an interactive terminal. Input is hidden; passwords are never CLI arguments. The script requires at least 12 characters, ASCII uppercase and lowercase letters, a number and a symbol, with at most 72 UTF-8 bytes to avoid bcrypt truncation. It stores a bcryptjs hash at cost 12 and sets `must_change_password=true`. It clears a prior lock and failed-attempt counter. An operator can run the same script to reset a forgotten password. No password is created automatically for existing Google accounts.

After a password is set, either login method leads to `/change-password` until the user changes that temporary password. Operational APIs also block access during this requirement. Password changes require the current password and a different policy-compliant new password; successful changes sign the current browser out. All prior Credentials sessions are invalidated by the stored password timestamp. Google sessions retain their existing lifecycle and continue to enforce active-user and RBAC checks.

Five wrong password verifications lock password authentication for 15 minutes. Row locks serialize attempts; an expired lock starts a new failure count, and successful authentication clears it. Incorrect current passwords in the change endpoint use the same counter. Google OAuth itself is not locked by Credentials failures. Unknown email, inactive identity, missing password, lockout and incorrect password receive the same login error: `Email atau password tidak valid.`

The password endpoint requires an authenticated identity, same-origin JSON POST and uses only the current actor's ID. Passwords and hashes are excluded from session, API responses and audit data. Audit records contain `PASSWORD_SET` (SYSTEM) or `PASSWORD_CHANGED` (WEB) metadata only. Database errors from password mutations are not logged with SQL parameters. Keep proxy origin/host configuration consistent with the public application URL.

## Verification

```powershell
npm run typecheck
npm run build
npm run db:smoke
npm run verify:static
npm run verify:auth
npm run verify:auth:db
```

The auth regression checks policy, bcrypt comparisons, lock duration/expiry, preserved Google allowlisting, session invalidation, forced-change authorization and endpoint origin/identity handling. The database regression creates a synthetic user, exercises the real password service and checks audit metadata; all fixtures are rolled back. Browser Google consent/callback and real-user interactive acceptance still require UAT. No existing user's password is changed by tests.

Implementation references: [Auth.js Credentials provider](https://authjs.dev/getting-started/authentication/credentials), [bcryptjs input limits](https://github.com/dcodeIO/bcrypt.js).


### Temporary Google OWNER access

Set `GOOGLE_TEMPORARY_OWNER_ACCESS=true` to automatically create an OWNER for a previously unregistered, verified Google email. New accounts see a five-second welcome transition before the dashboard. Existing roles and inactive accounts are preserved. Creation is recorded as `GOOGLE_OWNER_AUTO_GRANTED` in the audit log. No password is created.

This mode grants every new Google user access to all OWNER features and data. Set the flag to `false` and restart/redeploy to restore the normal access-request flow. Disabling it does not revoke OWNER accounts already created; manage those accounts separately. Existing pending requests remain as history and can be rejected by an administrator.
