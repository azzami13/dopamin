# Implementation Status v0.3

## Completed in this tranche

1. **RBAC Permission Matrix**
   - Action-level permissions for Owner, Director, Manager, Cashier, Kitchen.
   - Manager purchase-spend/receipt permissions separated from unrestricted finance mutations.
   - Server-side scope rules documented.

2. **Authentication & Authorization Foundation**
   - Auth.js Google OAuth scaffold.
   - Active-user allowlist backed by `users` + `roles`.
   - Request-time permission lookup from PostgreSQL.
   - Protected layout and role-aware navigation baseline.

3. **API & Integration Contract**
   - Response/error conventions.
   - HMAC signed Google webhook contract.
   - Mapping types and finance mutation contracts.

4. **Google Forms/Sheets Integration Runtime**
   - HMAC verification and replay-window enforcement.
   - Immutable raw revisions and payload-hash idempotency.
   - Cashier, Kitchen, Beverage mapping-driven normalizers.
   - Data Issues for invalid/missing mappings and anomalous values.
   - Apps Script submit + reconciliation replay template.

5. **Finance & Accounting Runtime**
   - Company Funding, Internal Transfer, Operational Expense services/API routes.
   - Balanced journal posting.
   - Audit write in the same DB transaction as each financial mutation.

## Validation performed

- Final RBAC and API DOCX files were rendered and visually reviewed page-by-page.
- TypeScript sources were syntax-parsed using the available global compiler. Full dependency-aware typecheck/build could not be completed in this environment because dependency installation timed out; run `npm install` followed by `npm run typecheck` and `npm run build` in the target development environment.

## Next tranche

- Purchase Request state-machine services + API + UI.
- Inventory/stock-opname services + role-scoped UI.
- Dashboard real SQL queries replacing scaffold values.
- Daily Closing + report snapshot + scheduler heartbeat/email callback.
- Data Issues correction workflow, reversal/repost and audit UI.
