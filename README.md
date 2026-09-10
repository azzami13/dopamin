# Dopamin Cafe Accounting & Inventory System

Password login is now available alongside the existing Google OAuth login, using the same users and RBAC. See [dual-login setup and verification](docs/DUAL_LOGIN.md) for migration `0003_dual_login.sql`, interactive password setup, lockout and mandatory password changes.

Unknown verified Google accounts can now request access without creating a user. Owner/Director approve or reject requests in Settings. Migration `0004_access_requests.sql` adds the request workflow and normalized user-email uniqueness; deployment instructions are in the same guide.

> **Codex handoff snapshot — v0.9.0-handoff**  
> Internal application for Dopamin Cafe. This repository is intended to be the single source tree handed off for continued implementation in Codex. It is **not yet certified as a production release** because actual Google ingestion, end-to-end UAT, backup/restore and deployment validation remain incomplete. Install, bootstrap, Neon connectivity and Owner OAuth/login were already verified; see section 28 for current evidence.

---

## 1. What application is this?

Dopamin Cafe Accounting & Inventory System is an internal web application/PWA designed to consolidate operational data that is currently entered through Google Forms/Google Sheets and turn it into normalized, auditable operational and financial data.

The application covers the following business areas:

- Cashier daily reporting and payment-method normalization.
- Food/Kitchen sales quantities and calculated revenue.
- Beverage/Barista sales quantities and calculated revenue.
- Housebank and Cashier Cash operational-fund movements.
- Company funding into Housebank.
- Internal transfer between Housebank and Cashier.
- Operational expenses.
- Purchase Request workflow.
- Stock Opname for Kitchen, Beverage/Bar, and Other inventory.
- Daily completeness/closing status.
- Daily management report snapshots and scheduled email delivery.
- Data Issues and controlled corrections.
- Double-entry-ready accounting journal for implemented financial transactions.
- Append-only audit trail.
- Role-based access control for Owner, Director, Manager, Cashier, and Kitchen.
- Installable PWA with conservative offline behavior for financial safety.

The system intentionally keeps **Google Forms as the staff-facing operational input for the MVP**. Google Sheets remains raw operational evidence; PostgreSQL is the normalized application database used by the dashboard, workflows, corrections, reporting, and audit history.

---

## 2. Business baseline

The source design documents in `docs/source-design/` are the business/design authority. Important baseline rules include:

- Business timezone: **Asia/Jakarta**.
- Cafe operating hours baseline: **10:00–21:30**.
- Reporting uses **Business Date**, not Google Form submission timestamp.
- Cashier Business Date comes from `Tanggal Pelaporan`.
- Kitchen Business Date comes from `Tanggal Penjualan/Tanggal penjualan`.
- Beverage must have an explicit `Tanggal Penjualan` before being considered final.
- Food revenue = valid quantity × menu price effective on the Business Date.
- Beverage revenue = valid quantity × menu price effective on the Business Date.
- Product sales and payment settlement are separate dimensions and must not be double-counted.
- Company → Housebank funding is **not sales revenue**.
- Housebank → Cashier is an **internal transfer**, not revenue or expense.
- Derived balances/totals/variances must not be directly edited.
- Original raw Google payload must not be destroyed by application corrections.
- Posted financial records must use VOID/reversal semantics rather than hard delete.
- Audit history must remain append-only.
- Scheduled daily email must still send when required source data is incomplete and must visibly state **BELUM LENGKAP**.
- Recipe/BOM automation and Moka integration are out of MVP scope.

Two accounting/business items remain intentionally unresolved and **must not be guessed by Codex**:

1. Final expected-closing-cash / opening-cash / petty-cash calculation.
2. Final accounting classification of the Company Funding / Intercompany account.

If these are needed, obtain explicit stakeholder/accounting approval first.

---

## 3. Source documents included

The handoff ZIP includes the original/derived design artifacts so Codex does not need to infer requirements from source code alone.

`docs/source-design/` contains:

- `SRS_Dopamin_Cafe_v0.1.docx`
- `ERD_Dopamin_Cafe_v0.1.docx`
- `ERD_Dopamin_Cafe_Sales_Cashier_v0.1.png`
- `ERD_Dopamin_Cafe_Finance_Purchase_Accounting_v0.1.png`
- `ERD_Dopamin_Cafe_Full_v0.1.svg`
- `SDD_Dopamin_Cafe_v0.1.docx`
- `UI_UX_Screen_Specification_Dopamin_Cafe_v0.1.docx`
- `Physical_Database_Specification_Dopamin_Cafe_v0.2.docx`

Additional implementation documents are in `docs/`:

- `RBAC_Permission_Matrix_Dopamin_Cafe_v0.3.docx`
- `API_Integration_Specification_Dopamin_Cafe_v0.3.docx`
- historical implementation-status notes
- `CODEX_HANDOFF.md`
- `IMPLEMENTATION_STATUS_CURRENT.md`
- `RELEASE_CHECKLIST.md`

---

## 4. Architecture

Selected architecture: **modular monolith / full-stack Next.js**.

```text
Operational staff
   │
   ├── Google Form: Cashier
   ├── Google Form: Kitchen
   └── Google Form: Beverage
             │
             ▼
        Google Sheets
             │
             ▼
      Google Apps Script
     signed HMAC webhook
             │
             ▼
┌─────────────────────────────────────────────┐
│ Next.js application                         │
│                                             │
│ auth / RBAC                                 │
│ integration / normalization                 │
│ cashier / sales                             │
│ finance / accounting                        │
│ purchase / inventory                        │
│ reporting / corrections / audit / settings │
└───────────────────┬─────────────────────────┘
                    │
                    ▼
               PostgreSQL

Google Apps Script timer
        │
        └────────────► daily report heartbeat
                        │
                        └── backend snapshot
                               │
                               └── MailApp delivery
```

### Runtime principles

- Browser/UI is never trusted for authorization or financial calculations.
- Authorization is enforced server-side.
- Material financial writes should commit domain data + journal + audit in one PostgreSQL transaction.
- Google integration is eventually consistent, but backend ingestion is idempotent.
- Dashboard/reporting reads PostgreSQL views rather than querying Sheets directly.
- Raw Form/Sheet evidence is retained.
- Core schema avoids provider-specific DB features except standard PostgreSQL extensions required by the schema.

---

## 5. Technology stack

Current repository baseline:

- **Next.js** App Router
- **React**
- **TypeScript**
- **NextAuth/Auth.js-style Google OAuth integration**
- **PostgreSQL**
- **Drizzle ORM**
- **postgres-js**
- **Zod** validation
- **Decimal.js** for money-safe calculations in application code
- **Recharts** dependency reserved for charting
- **Google Apps Script** for Form/Sheet webhook, reconciliation replay, scheduler heartbeat, and MailApp delivery
- PWA manifest + service worker

> Dependencies are installed and `package-lock.json` is tracked. The installed baseline uses Next.js 16.3.4 and Auth.js/NextAuth v5. All direct dependencies/devDependencies are pinned to the installed lockfile versions; use `npm ci` for reproducible installs. Preserve the working Auth.js v5 flow.

---

## 6. Repository layout

```text
.
├── README.md
├── package.json
├── tsconfig.json
├── drizzle.config.ts
├── .env.example
│
├── docs/
│   ├── CODEX_HANDOFF.md
│   ├── IMPLEMENTATION_STATUS_CURRENT.md
│   ├── RELEASE_CHECKLIST.md
│   ├── API_Integration_Specification_Dopamin_Cafe_v0.3.docx
│   ├── RBAC_Permission_Matrix_Dopamin_Cafe_v0.3.docx
│   └── source-design/
│       └── SRS / ERD / SDD / UIUX / Physical DB specs
│
├── integrations/
│   └── google-apps-script/
│       ├── Code.gs
│       └── README.md
│
├── public/
│   ├── sw.js
│   └── icons/
│
├── scripts/
│   ├── bootstrap-db.ts
│   ├── create-user.ts
│   ├── seed.ts
│   ├── db-smoke.ts
│   └── verify-static.mjs
│
└── src/
    ├── app/
    │   ├── (auth)/login/
    │   ├── (protected)/
    │   │   ├── dashboard/
    │   │   ├── sales/
    │   │   ├── cashier/
    │   │   ├── finance/
    │   │   ├── purchase/
    │   │   ├── inventory/
    │   │   ├── reports/
    │   │   ├── data-issues/
    │   │   ├── audit/
    │   │   └── settings/
    │   ├── api/
    │   ├── offline/
    │   └── manifest.ts
    │
    ├── components/
    ├── db/
    │   ├── migrations/
    │   ├── schema/
    │   ├── seed/
    │   └── views/
    │
    ├── lib/
    └── modules/
```

---

## 7. Roles and access model

MVP roles:

### OWNER

Leadership/superuser role. Intended access:

- full executive dashboard
- all sales/cashier/finance modules
- company funding
- transfers and expenses
- Purchase Requests and approvals
- all inventory categories
- reports
- corrections/data issues
- audit trail
- settings, users, menu/prices, integrations

### DIRECTOR

Similar to Owner for MVP, especially:

- full reporting
- Housebank funding
- approvals
- finance
- audit/settings

### MANAGER

Operational role:

- operational dashboard
- sales overview
- cashier detail/monitoring
- Purchase Request create/manage
- inventory and stock review
- operational reports
- Data Issues/corrections according to scope
- no default Company → Housebank funding permission

### CASHIER

Operational scope:

- Cashier reports
- Beverage/Bar data
- Beverage/Bar inventory
- own-source views where identity resolution is available
- no Housebank company funding
- no unrestricted audit/settings

### KITCHEN

Operational scope:

- Food/Kitchen sales
- Kitchen inventory
- own-source views where identity resolution is available
- no Housebank/finance account detail

Permissions are defined in `src/lib/auth/permissions.ts` and seeded in `src/db/seed/`.

---

## 8. Authentication

Authentication is based on Google OAuth.

Important behavior:

- Successful Google authentication alone is **not sufficient**.
- The email must already exist in `users` and the user/role must be active.
- OAuth sign-in calls `findActiveActorByEmail()` before access is granted.
- App authorization then uses server-side permissions from PostgreSQL.
- Session strategy is JWT with an 8-hour max age in the current baseline.

### Bootstrap the first Owner

After the database is created and seeded:

```bash
npm run user:create -- "owner@example.com" "Owner Dopamin" OWNER
```

Then ensure that email is the same Google account used to log in.

---

## 9. Database model

Core tables include:

### Access / identity

- `roles`
- `permissions`
- `role_permissions`
- `users`
- `user_source_aliases`

### Integration

- `data_sources`
- `source_field_mappings`
- `raw_submissions`
- `sync_runs`
- `data_issues`

### Master data

- `chart_of_accounts`
- `payment_methods`
- `expense_categories`
- `menu_items`
- `menu_price_history`
- `fund_accounts`

### Cashier / sales

- `cashier_reports`
- `payment_lines`
- `cashier_expense_lines`
- `cash_counts`
- `sales_reports`
- `sales_report_items`

### Finance / purchase / accounting

- `fund_transactions`
- `purchase_requests`
- `purchase_request_items`
- `purchase_request_actions`
- `purchase_receipts`
- `journal_entries`
- `journal_lines`

### Inventory

- `inventory_items`
- `stock_opname_sessions`
- `stock_opname_lines`

### Reporting / governance

- `daily_closings`
- `daily_report_settings`
- `daily_report_recipients`
- `daily_report_runs`
- `daily_report_deliveries`
- `data_corrections`
- `data_correction_items`
- `audit_logs`
- `system_settings`

Money uses PostgreSQL `NUMERIC(18,2)`; quantities use `NUMERIC(18,3)`.

---

## 10. Database migrations, views, and seeds

### Migrations

- `0000_initial_schema.sql`
  - full baseline schema
  - `pgcrypto`
  - `btree_gist`
  - base constraints/indexes
- `0001_handoff_hardening.sql`
  - `user_source_aliases`
  - source identity mapping hardening

- `0002_raw_submission_revision_hardening.sql`
  - supports payload reversion A -> B -> A by retaining unique revision identity and using a nonunique payload lookup index
  - applied alone to existing Neon on 2026-09-10; bootstrap was not rerun

### Reporting views

- `vw_daily_sales_summary`
- `vw_daily_payment_summary`
- `vw_daily_cashier_expenses`
- `vw_housebank_ledger`
- `vw_cashier_cash_reconciliation_base`
- `vw_daily_completeness`
- `vw_daily_management_report`

`002_hardening_views.sql` changes completeness so a source is complete only when **all current non-superseded reports for that source/date are VALID**. A date with both VALID and NEEDS_REVIEW rows must not incorrectly become complete.

### Seeds

Seeds create baseline:

- roles
- permissions
- role-permission mapping
- chart of accounts
- payment methods
- base fund accounts
- default Data Sources/settings needed by the MVP

Production-specific users, menu items/prices, actual expense categories, actual inventory, spreadsheet IDs, mappings, and recipients still need real Dopamin data.

---

## 11. Google Forms / Sheets integration

### Flow

```text
Google Form submission
       │
       ▼
Google Sheet row
       │
       ▼
Apps Script onFormSubmit
       │
       ├── canonical envelope
       ├── timestamp
       └── HMAC-SHA256 signature
       │
       ▼
POST /api/integrations/google-form/[sourceKey]
       │
       ▼
raw_submissions
       │
       ▼
normalizer
       │
       ├── cashier_reports / lines
       └── sales_reports / items
       │
       ▼
data issues + audit + daily closing evaluation
```

Supported source families in the webhook baseline:

- `CASHIER`
- `KITCHEN`
- `BEVERAGE`

OPEX historical import is represented in the data model/design but is not treated as a normal live Google Form webhook by the current ingestion service.

### Idempotency

The ingestion service hashes the raw payload.

- same source + same row key + same payload hash as the latest revision → idempotent/no duplicate
- same row key + changed payload (including A -> B -> A) → a new raw revision is inserted
- previous revisions are superseded atomically with successful normalization; failures retain raw ERROR evidence and flag earlier current reports NEEDS_REVIEW

The original raw payload is retained in JSONB. Per-source transaction locks serialize ingestion/reprocess/correction. Apps Script now uses persisted UUIDs in a hidden internal column instead of permanent row-number identity. Apps Script uses identical live/replay payloads and supports bounded checkpointed `backfillRows()`. See [setup and exact blockers](integrations/google-apps-script/README.md).

### Source field mappings

Google Form column labels are not meant to be hardcoded forever. `source_field_mappings` maps source field names to controlled targets.

Common `mapping_type` concepts used by current normalizers:

- `BUSINESS_DATE`
- `CASHIER_NAME`
- `INPUTTER_NAME`
- `SHIFT_CODE`
- `TRANSACTION_TYPE`
- `OPENING_CLOSING_STATUS`
- `PETTY_CASH`
- `CASH_OUTSIDE_PETTY`
- `PAYMENT`
- `EXPENSE`
- `CASH_COUNT`
- `SALE_ITEM`

Example concept:

```text
"Pembayaran Cash"     PAYMENT     CASH
"Pembayaran Cash 2"   PAYMENT     CASH
"Americano"           SALE_ITEM   AMERICANO
```

### Source identity aliases

`user_source_aliases` maps raw names from Google Forms to application users.

Example:

```text
source_code = CASHIER
alias       = "Asep"
user        = asep@dopamin.example
```

The normalizer stores the mapped `cashier_user_id`/`inputter_user_id`. If a non-empty name cannot be resolved, it creates a `USER_NOT_RESOLVED` Data Issue and the normalized report is flagged for review.

Aliases can be managed from Settings for users with `USER_MANAGE`.

---

## 12. Cashier normalization

The Cashier normalizer currently supports:

- Business Date parsing.
- Cashier raw identity.
- user alias resolution.
- shift/transaction/opening-closing metadata.
- petty-cash source value.
- cash-outside-petty source value.
- payment lines.
- duplicated branch-payment warning.
- cashier expense lines.
- cash denomination counts.
- Data Issues when mappings/master records are missing or invalid.

### Important limitation

The application deliberately does **not** calculate final expected closing cash or final variance yet.

Known components are available:

- cash receipts
- cashier expenses
- actual denomination count
- petty-cash source value
- cash-outside-petty source value

But the approved opening/petty-cash formula is still required before a financial reconciliation result can be considered authoritative.

---

## 13. Food and Beverage sales

Kitchen and Beverage forms are unpivoted from wide columns into `sales_report_items`.

Each item stores:

- quantity
- menu item reference
- menu price history reference
- unit-price snapshot
- original source-field label

Price resolution uses Business Date:

```text
revenue = quantity × price effective on Business Date
```

Changing a menu price later must not change historical revenue already snapshotted into normalized sales rows.

The current handoff adds read screens for:

- `/sales`
- `/sales/[id]`

Role scope:

- Kitchen → FOOD / own mapped source
- Cashier → BEVERAGE / own mapped source
- Manager / Owner / Director → both categories

---

## 14. Finance and accounting currently implemented

The finance service already implements transactional writes for:

### Company funding

```text
Company → Housebank
```

- creates `fund_transactions`
- posts a two-line journal
- writes audit event
- all in one PostgreSQL transaction
- does not increase cafe sales revenue

### Internal transfer

```text
Housebank → Cashier Cash
```

- source and destination must differ
- posts asset-to-asset journal
- not revenue
- not expense

### Operational expense

```text
Housebank/Cashier → Expense
```

- requires active expense category
- creates fund transaction
- debit expense account
- credit source fund account
- audit written in same transaction

### Financial VOID/reversal

The v0.4 baseline includes financial transaction VOID/reversal handling through its API/service path. Posted history is retained rather than deleted.

### Finance read screens added in handoff

- `/finance`
- `/finance/[id]`

They show derived fund balances, transaction history, and related journal lines.

### Accounting still to complete in Codex

Daily product sales / Cashier settlement **Sales Clearing accounting posting is not complete in this exported source tree**. It must be added according to SDD rules rather than invented.

Required future behavior:

```text
Cash/QRIS/Transfer settlement  -> Sales Clearing
Sales Clearing                 -> Food Revenue
Sales Clearing                 -> Beverage Revenue
```

Only post when required sources are valid and reconciliation policy is satisfied. DP, Receivable, Promotion/Cooperation require explicit approved accounting treatment.

---

## 15. Purchase Request workflow

Current v0.4 implementation contains:

```text
DRAFT
  ↓
SUBMITTED
  ├── APPROVED
  │      ↓
  │  FUNDED_READY_TO_SPEND
  │      ↓
  │   PURCHASED
  │      ↓
  │ RECEIPT_RECORDED
  │      ↓
  │    CLOSED
  │
  ├── REVISION_REQUESTED
  └── REJECTED
```

Implemented concepts include:

- Manager creates/edits draft.
- Submit.
- Owner/Director approve/revise/reject.
- funding source Housebank or Cashier.
- actual spend can create linked financial transaction + journal + audit.
- receipt record/reference.
- close flow.

Pages:

- `/purchase`
- `/purchase/new`
- `/purchase/[id]`

---

## 16. Inventory / Stock Opname

MVP categories:

- `KITCHEN`
- `BAR`
- `OTHER`

Implemented baseline:

- Stock Opname session.
- Role-scoped category access.
- reference quantity when available.
- actual quantity.
- calculated variance.
- note.
- submit/review states.
- submitted/reviewed state becomes locked in the baseline.
- audit events.

Pages:

- `/inventory`
- `/inventory/[id]`

Recipe/BOM theoretical consumption is intentionally not implemented.

### Still needed

A dedicated post-lock audited stock-correction UX/service is still a Codex task.

---

## 17. Daily Closing and reporting

Current reporting layer includes:

- daily management views
- dashboard data
- completeness state
- immutable daily report runs
- report recipients
- delivery records
- manual resend/revision flow
- signed scheduler heartbeat and delivery callback integration

Required source groups for basic daily completeness:

- Cashier
- Kitchen
- Beverage

If one or more are missing/not valid, report status remains incomplete.

Scheduled email is designed to still send with:

```text
BELUM LENGKAP
```

and missing-source indicators.

Pages:

- `/reports`
- `/reports/[id]`

---

## 18. Dashboard

`/dashboard` reads PostgreSQL reporting views, not placeholder frontend data.

Role-specific presentation currently includes:

- Owner/Director executive metrics.
- Manager operational completeness/PR/stock signals.
- Cashier payment/submission context.
- Kitchen source/stock context without finance exposure.

Executive data examples:

- product sales
- Cashier inflow
- Cashier expense
- Housebank derived balance
- 7-day revenue trend
- source completeness

---

## 19. Data Issues and corrections

Current baseline contains:

- `data_issues`
- Data Issues list/API
- normalized-field correction service/API
- correction header/items
- reason requirement
- audit integration
- correction recalculation for supported fields

The current code preserves raw Google payload rather than overwriting it.

### Still needed

Codex should complete:

- raw-source correction overlay for failures that have no normalized target row yet
- reprocess operator UI and mapping-version attempt history (a guarded latest ERROR/NEEDS_REVIEW reprocess API now exists)
- source-change acceptance UX and stale-event ordering (atomic normalization/replacement is implemented)
- own-source authorization audit for every correction path
- post-correction daily-sales accounting reversal/repost once Sales Clearing is implemented

---

## 20. Audit Trail

Audit data is append-only at the application level.

The handoff contains read screens:

- `/audit`
- `/audit/[id]`

Owner/Director are expected to receive full audit scope. Limited operational audit currently restricts visible modules in the read service and should be reviewed against the RBAC document during Codex hardening.

No UI delete/edit action exists for audit events.

---

## 21. PWA behavior

The application includes:

- manifest
- icons
- service worker
- offline page
- network-status warning
- installable standalone behavior on compatible browsers

### Financial safety policy

The service worker intentionally does **not** cache:

- `/api/*`
- mutations
- authentication traffic

There is no offline queue for funding, transfer, expense, approval, correction, reprocess, or settings changes.

Protected navigation is network-first. Offline fallback is a generic page rather than stale financial HTML.

### Update strategy

A newly installed service worker waits rather than immediately taking control. The UI shows:

```text
Versi aplikasi baru tersedia.
[Perbarui sekarang]
```

Only after user action does the worker call `skipWaiting`, reducing the chance of an unexpected reload during financial work.

---

## 22. Environment variables

This workspace uses `.env`; preserve its working secrets. For a fresh checkout only:

```bash
cp .env.example .env
```

Variables:

```env
DATABASE_URL=postgresql://user:password@host:5432/dopamin
DATABASE_MIGRATION_URL=postgresql://user:password@host:5432/dopamin

AUTH_SECRET=
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=

GOOGLE_INTEGRATION_SECRET=
REPORT_JOB_SECRET=

APP_BASE_URL=http://localhost:3000
BUSINESS_TIMEZONE=Asia/Jakarta
LOG_LEVEL=info
```

### Notes

- `DATABASE_URL` is used by the application runtime.
- `DATABASE_MIGRATION_URL` may use a direct/admin connection for bootstrap/migrations; if omitted, bootstrap falls back to `DATABASE_URL`.
- `AUTH_SECRET` must be a strong production secret.
- Google OAuth credentials must match the deployed application callback configuration.
- `GOOGLE_INTEGRATION_SECRET` must match Apps Script `DOPAMIN_INTEGRATION_SECRET`.
- `REPORT_JOB_SECRET` must match Apps Script `DOPAMIN_REPORT_JOB_SECRET`.

Never commit real secrets.

---

## 23. Fresh local setup

### Prerequisites

Recommended:

- Node.js 20+ or 22+
- npm
- PostgreSQL with permission to create/use `pgcrypto` and `btree_gist`
- Google Cloud OAuth credentials for login testing
- optional Google Apps Script project for integration testing

### Step 1 — install

```bash
npm install
```

The current workspace already has installed dependencies and a tracked lockfile. Use `npm ci` for a fresh reproducible installation; typecheck and production build pass. Direct dependency versions are pinned to the verified lockfile baseline.

### Step 2 — configure environment

```bash
cp .env.example .env
```

Fill all required values.

### Step 3 — bootstrap fresh PostgreSQL

```bash
npm run db:bootstrap
```

`bootstrap-db.ts` applies, in order:

1. every SQL file in `src/db/migrations/`
2. every SQL file in `src/db/views/`
3. every SQL file in `src/db/seed/`

Files are sorted by filename.

### Step 4 — create initial Owner

```bash
npm run user:create -- "owner@example.com" "Owner Dopamin" OWNER
```

### Step 5 — start app

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

### Step 6 — health check

```text
GET /api/health
```

Expected healthy response includes database reachability.

---

## 24. Required production master-data setup

A fresh seed is not enough for real cafe reporting.

Before production, configure actual Dopamin data:

1. Real application users.
2. Google Form source-name aliases.
3. Spreadsheet IDs and sheet names.
4. Source field mappings.
5. Actual Food menu master.
6. Actual Beverage menu master.
7. Effective price history.
8. Actual expense categories and linked COA accounts.
9. Inventory item master.
10. Daily report time and recipients.
11. Any agreed validation thresholds.
12. Approved accounting policy for unresolved cases.

Do not seed invented menu prices or accounting policy as production truth.

---

## 25. Google Apps Script setup

See:

```text
integrations/google-apps-script/README.md
```

Typical Script Properties:

```text
DOPAMIN_BASE_URL
DOPAMIN_INTEGRATION_SECRET
DOPAMIN_SOURCE_KEY
DOPAMIN_REPORT_JOB_SECRET
```

Set Apps Script timezone to `Asia/Jakarta`.

Create:

- installable `On form submit` trigger for `onFormSubmit`
- optional reconciliation/replay trigger
- time-driven trigger for `dailyReportHeartbeat` (design recommendation ~15 minutes)

Backend idempotency must remain the protection against duplicate delivery/replay.

---

## 26. Important API surfaces currently present

### Auth / identity

```text
/api/auth/[...nextauth]
GET /api/me
```

### Integration

```text
POST /api/integrations/google-form/[sourceKey]
```

### Finance

```text
POST /api/finance/funding
POST /api/finance/transfer
POST /api/finance/expense
POST /api/finance/transactions/[id]/void
```

### Purchase

```text
/api/purchase/requests
/api/purchase/requests/[id]
/api/purchase/requests/[id]/submit
/api/purchase/requests/[id]/decision
/api/purchase/requests/[id]/funding-source
/api/purchase/requests/[id]/spend
/api/purchase/requests/[id]/receipt
/api/purchase/requests/[id]/close
```

### Inventory

```text
/api/inventory/items
/api/inventory/sessions
/api/inventory/sessions/[id]
/api/inventory/sessions/[id]/lines
/api/inventory/sessions/[id]/submit
/api/inventory/sessions/[id]/review
```

### Reports / scheduler

```text
/api/reports/daily
/api/reports/daily/[id]
/api/reports/daily/resend
/api/jobs/daily-report/heartbeat
/api/jobs/daily-report/delivery
```

### Corrections / data issues

```text
/api/data-issues
/api/corrections
```

### Settings

```text
/api/settings/daily-report
/api/settings/source-aliases
```

### Operations

```text
GET /api/health
```

Refer to `docs/API_Integration_Specification_Dopamin_Cafe_v0.3.docx` and the actual route source. If they differ, **actual current route code is the implementation truth**, while the SRS/SDD remains the intended behavior authority.

---

## 27. Verification commands

### Static verification — no installed local project dependencies required if global TypeScript is available

```bash
npm run verify:static
```

Checks include:

- required artifacts
- local import resolution
- TypeScript/TSX syntax parsing when global TypeScript can be found
- presence of critical routes/migrations/docs

### Dependency-aware type check

```bash
npm run typecheck
```

### Production build

```bash
npm run build
```

### Database smoke test

After a real database is bootstrapped:

```bash
npm run db:smoke
```

It checks:

- required tables
- required views
- balanced POSTED journals
- internal-transfer integrity
- raw payload duplicate identity
- core role seeds
- core Housebank/Cashier fund seeds
- warning for overlapping menu-price periods

---

## 28. Current verification status - 2026-09-10

Stakeholder-verified before this task: npm install, dependencies, PostgreSQL bootstrap, DB smoke (40 tables/7 views), Neon connectivity, Owner bootstrap, Auth.js v5 Google OAuth, Owner login/dashboard, typecheck and production build. Bootstrap and OAuth setup were not repeated here.

Verified again in this session:

- Typecheck and full Next.js 16.3.4 / Turbopack production build: PASS.
- DB smoke: PASS, 40 tables, 7 views and core invariants.
- Static artifacts/imports: PASS; optional global syntax-parser step skipped.
- All three actual sales overview queries execute against Neon with DB Owner permission and return empty results for an empty interval. Local tests preserve all five role scopes.
- `/api/health`: 200. Unauthenticated dashboard/sales/cashier/finance: 307 to login. Unsigned webhook: 401.
- Synthetic DB regression (2026-09-10): PASS for A -> B -> A -> A revision/replay, temporary Google configuration and explicit Business Date mapping, mapping reprocess, permission denial, changed-row supersession, raw retention, normalization failure savepoint and audit. All fixtures were rolled back; this is not actual Google ingestion.
- Health responses use no-store on success/failure and never expose DB error messages.
- Local HMAC and Apps Script mocks: payload parity, business date serialization, headers, retry and cursor tests pass.

npm script wrappers could not launch in this shell (execution policy / command-shell launcher). Equivalent installed entry points were used: `node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/next/dist/bin/next build`, and `node --experimental-strip-types scripts/db-smoke.ts`. Database checks required network-enabled execution. Direct dependency ranges and root lockfile metadata were pinned to existing installed versions; no package upgrades, auth refactor or secret changes were made.

Authenticated Owner browser pages were NOT RETESTED here. The real `/sales` query regression is verified, but browser OAuth UAT was not repeated. Actual Google Sheet ingestion and MailApp delivery remain NOT TESTED. This is not production-ready.

See `docs/IMPLEMENTATION_STATUS_CURRENT.md` and `integrations/google-apps-script/README.md` for details and blockers.

---

## 29. Known gaps / next Codex priorities

Recommended priority order:

### P0 - established runtime baseline

Install/lockfile, bootstrap, typecheck, build, DB smoke and health are established. The `/sales` record-to-array cast bug is fixed using bound SQL parameters. Next: retest `/sales` in the working Owner browser session, then configure and test actual source ingestion.

### P1 — data/integration correctness

1. Review raw-revision semantics when source rows change.
2. Exercise the guarded reprocess API with actual mappings; add operator UI later.
3. Implement raw-source correction overlay without overwriting raw payload.
4. Harden own-source authorization on all Data Issue/correction/detail APIs.
5. Validate active master targets when saving mappings.
6. Add configurable suspicious-value thresholds.

### P1 — accounting completeness

1. Implement Sales Clearing preview.
2. Implement guarded daily sales posting.
3. Block/handle DP, Receivable, Promotion according to approved policy.
4. Add accounting journal list/detail UI if needed beyond finance-linked journal lines.
5. Reverse/repost daily sales journals atomically after approved source corrections.

### P1 — master-data administration

Complete UI/API for:

- users activation/roles
- menu item activation
- effective price history
- payment methods
- expense categories
- inventory item master
- source configuration
- versioned field mappings
- validation thresholds

### P2 — inventory correction hardening

Add audited correction flow for submitted/reviewed Stock Opname rather than reopening/editing history.

### P2 — reporting/export

Add/verify:

- CSV export
- XLSX export where required
- weekly/monthly management report
- exact filter parity between UI and export

### P2 — PWA/responsive polish

- finalize mobile bottom navigation if desired by UI/UX spec
- test iOS standalone behavior
- test Android install/update
- test offline fallback
- ensure no sensitive API response is persisted by service worker/browser application cache

### P3 — release engineering

- test database backup/restore
- deployment runbook
- structured logging/observability
- security headers
- rate limiting/replay checks as required
- staging/production environment separation
- UAT checklist with real cafe data

See `docs/CODEX_HANDOFF.md` for a concise continuation plan.

---

## 30. Release definition

Do **not** call this production-ready until all of these pass:

```text
[x] npm install succeeds
[x] package lock committed
[x] static verification passes
[x] dependency-aware TypeScript typecheck passes
[x] Next.js production build passes
[x] fresh PostgreSQL bootstrap passes
[x] DB smoke test passes
[x] Owner login works
[ ] role authorization tested
[ ] Google Cashier ingestion tested
[ ] Google Kitchen ingestion tested
[ ] Google Beverage ingestion tested
[ ] idempotent replay tested
[ ] changed-row revision tested
[ ] Company Funding journal tested
[ ] internal transfer journal tested
[ ] operational expense journal tested
[ ] PR workflow tested
[ ] Stock Opname workflow tested
[ ] correction/reversal behavior tested
[ ] daily closing tested
[ ] incomplete daily email tested
[ ] report revision/resend tested
[ ] PWA install/update/offline tested
[ ] database backup and restore tested
[ ] stakeholder UAT signed off
```

---

## 31. Guidance for Codex

When continuing this project in Codex:

1. **Read `docs/CODEX_HANDOFF.md` first.**
2. Read the SRS/ERD/SDD/UIUX files in `docs/source-design/` before changing business behavior.
3. Treat SRS as business requirement authority.
4. Treat ERD/Physical DB spec as intended data-model authority, but preserve later migrations that intentionally refine the baseline.
5. Treat SDD as architecture/accounting/integration behavior authority.
6. Treat UI/UX spec as navigation/responsive/screen intent authority.
7. Never invent unresolved accounting rules.
8. Never overwrite/delete original Google raw evidence as a correction shortcut.
9. Never directly edit derived balances/totals/variances.
10. Keep finance mutation + journal + audit atomic.
11. Do not add an offline queue for financial mutations in MVP.
12. Before large refactors, get the existing tree to build and establish tests first.
13. Prefer incremental migrations; do not rewrite production migration history after deployment begins.
14. Keep PostgreSQL provider portability.
15. Update this README and `IMPLEMENTATION_STATUS_CURRENT.md` whenever a major milestone changes.

---

## 32. Handoff note about version history

During earlier iterative work, intermediate v0.5–v0.9 status folders in the ChatGPT runtime did not retain full source snapshots. The last complete exported code baseline available was v0.4. To avoid pretending missing source existed, this handoff package was reconstructed from that complete baseline and then hardened directly with:

- ordered multi-migration bootstrap
- `user_source_aliases` migration/schema
- source-user resolution in normalizers
- source-alias Settings API/UI
- Sales read/query screens
- Cashier read/query screens
- Finance read/query screens
- Audit read/query screens
- daily completeness hardening view
- `/api/health`
- static verification script
- database smoke-test script
- safer opt-in PWA update activation
- full source-design documentation bundle
- explicit Codex handoff/release documentation

Therefore **the repository contents, not earlier conversational progress claims, are the implementation source of truth for Codex**.

---

## 33. Confidentiality / usage

This project contains internal business-process, accounting, operational, and data-model information for Dopamin Cafe. Treat the repository and its included documents as confidential internal material unless the owner explicitly authorizes broader distribution.

---

## Quick command summary

```bash
# 1. install
npm install

# 2. environment
cp .env.example .env

# 3. verify source
npm run verify:static

# 4. fresh DB
npm run db:bootstrap

# 5. create first owner
npm run user:create -- "owner@example.com" "Owner Dopamin" OWNER

# 6. validate DB
npm run db:smoke

# 7. typecheck/build
npm run typecheck
npm run build

# 8. run
npm run dev
```

Health endpoint:

```text
GET /api/health
```

Primary continuation guide:

```text
docs/CODEX_HANDOFF.md
```
