# Implementation Status v0.4

v0.4 continues directly from the v0.3 source baseline. No user-side merge is required between these versions; v0.4 contains the previous work plus this tranche.

## Completed in this tranche

1. **Purchase Request workflow**
   - Draft/create/edit with derived estimated total from request items.
   - Submit, Approve, Revision Request, Reject.
   - Housebank/Cashier funding-source selection.
   - Actual spend posts a linked fund transaction + balanced journal + audit in one DB transaction.
   - Receipt/nota link record and Close state.
   - Server APIs and operational UI pages.

2. **Inventory / Stock Opname**
   - Role-scoped category access: Kitchen -> KITCHEN, Cashier -> BAR, Manager -> OTHER input + consolidated review, Owner/Director -> all.
   - Draft line upsert, actual/reference quantities, derived variance, missing-count indicator.
   - Submit and Review lock states with audit events.
   - API and responsive stock-opname UI.

3. **Real dashboard queries**
   - Dashboard now reads PostgreSQL reporting views instead of placeholder values.
   - Role-specific executive / manager / cashier / kitchen cards.
   - 7-day sales trend, completeness, Housebank balance, PR count and stock exception signals.

4. **Daily Closing + scheduled email/report snapshots**
   - Closing reevaluates after valid Google ingestion and after corrections.
   - Configurable daily-report settings + recipients API/UI.
   - Signed Apps Script heartbeat and signed delivery callback.
   - Incomplete data still generates `BELUM LENGKAP` email with missing-source indicators.
   - Immutable `daily_report_runs` snapshots + per-recipient deliveries.
   - Owner/Director manual Generate/Resend creates versioned revisions and queues delivery for Apps Script heartbeat.
   - Daily report history/detail UI.

5. **Data Issues / Corrections / Financial Void**
   - Open issue list with role scope.
   - Common normalized-line issue target resolution.
   - Audited correction for payment amount, cashier expense, cash count, sales quantity, selected report source fields.
   - Sales Business Date correction also re-resolves effective menu-price snapshots transactionally.
   - Original raw Google payload is not overwritten.
   - Owner/Director financial VOID marks the fund transaction VOID and creates a separate posted reversing journal while leaving the original posted journal immutable.

6. **Fresh DB bootstrap usability**
   - Fresh PostgreSQL bootstrap script applies schema, reporting views and all seed files in order.
   - Initial-user CLI allows the first approved OAuth account to be created before login.
   - `pgcrypto` and `btree_gist` extensions are explicitly created on fresh DB bootstrap.

## Validation performed in this environment

- Every `.ts` / `.tsx` source currently passes TypeScript parser/transpile syntax validation using the available global TypeScript compiler.
- Full dependency-aware `npm run typecheck` and `npm run build` are **not yet certified** because package installation from the registry timed out in this environment. The codebase must not be called release-ready until an actual dependency install + typecheck + Next.js production build + PostgreSQL integration test succeeds.

## Important source-baseline constraints still preserved

- Final expected-closing-cash / petty-cash formula remains deferred because the SDD explicitly leaves it for current Cashier Form/UAT validation.
- `Company Funding / Intercompany` COA classification remains provisional pending accounting sign-off.
- Google Sheets remains immutable raw operational evidence; PostgreSQL is normalized application/reporting truth.
- Product sales and payment settlement remain separate reconciliation dimensions; no artificial balancing is introduced.
- Protected finance, approval, correction and settings mutations are never queued offline by the PWA.

## Remaining before a final downloadable release

- Complete Sales, Cashier and Finance screen sets and detail/reconciliation pages.
- Sales Clearing accounting posting after daily reconciliation; journal reporting UI.
- Audit Trail list/detail UI and scoped manager audit view.
- Master/configuration UIs: users, menu/effective prices, payment/expense masters, inventory item master, integration source/mapping status.
- Raw-source correction overlay + controlled reprocess for issues where normalization never produced a line (for example invalid/missing Business Date, missing menu mapping/price).
- Post-review stock correction flow.
- CSV/XLSX exports required by reporting scope.
- Backup/recovery operational script/checklist.
- Actual dependency install, package lock, typecheck, production build, database smoke/integration tests, Apps Script test, and UAT.
