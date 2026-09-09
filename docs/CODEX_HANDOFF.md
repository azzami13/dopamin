# Codex Handoff — Dopamin Cafe v0.9.0-handoff

## Start here

This repository is an implementation handoff, not a certified production release.

Before editing business logic, read:

1. `README.md`
2. `docs/IMPLEMENTATION_STATUS_CURRENT.md`
3. `docs/RELEASE_CHECKLIST.md`
4. `docs/source-design/SRS_Dopamin_Cafe_v0.1.docx`
5. `docs/source-design/ERD_Dopamin_Cafe_v0.1.docx`
6. `docs/source-design/SDD_Dopamin_Cafe_v0.1.docx`
7. `docs/source-design/UI_UX_Screen_Specification_Dopamin_Cafe_v0.1.docx`

## First Codex task: establish a real green baseline

Do not start with a large feature refactor.

Run:

```bash
npm install
npm run verify:static
npm run typecheck
npm run build
```

Then provision a disposable PostgreSQL database and run:

```bash
npm run db:bootstrap
npm run db:smoke
```

Create the first user:

```bash
npm run user:create -- "owner@example.com" "Owner Dopamin" OWNER
```

Start the app and verify:

```bash
npm run dev
```

Then test:

```text
GET /api/health
/login
/dashboard
/sales
/cashier
/finance
/purchase
/inventory
/reports
/data-issues
/audit
/settings
```

Fix all compile/runtime problems before adding the next major domain feature.

## Important business invariants

Do not break these:

- Google raw submission is evidence; corrections must not overwrite it destructively.
- Business Date controls cafe reporting.
- Product sales and payment settlement are separate dimensions.
- Company funding is not sales revenue.
- Housebank ↔ Cashier transfer is not revenue/expense.
- Financial balance is derived, not directly editable.
- POSTED financial history is not hard-deleted.
- Audit history is append-only.
- financial mutation + journal + audit should commit atomically.
- daily email still sends when incomplete and says BELUM LENGKAP.
- no financial mutation offline queue in MVP.
- recipe/BOM and Moka integration are future phases.

## Do not guess these unresolved policies

1. final expected closing cash / petty cash formula
2. final Company Funding/Intercompany accounting classification
3. DP / Promotion / Receivable sales-accounting treatment unless approved

## Highest-priority implementation backlog

### 1. Build/runtime validation

- obtain a green install/typecheck/build
- generate and commit package lock
- validate PostgreSQL bootstrap/migrations
- resolve any Drizzle/Next/Auth version compatibility

### 2. Integration hardening

- controlled source reprocess
- raw-source correction overlay
- mapping target validation
- own-source scope enforcement on all endpoints
- changed-row acceptance/rejection semantics
- warning thresholds

### 3. Daily Sales Clearing accounting

Implement according to SDD, not by summing payment and sales as separate revenue.

Expected concept:

```text
Cash/QRIS/Transfer/etc -> Sales Clearing
Sales Clearing         -> Food Revenue
Sales Clearing         -> Beverage Revenue
```

Post only after reconciliation gates pass.

### 4. Master administration

Build secure Owner/Director screens/APIs for:

- users
- menu items
- price history
- payment methods
- expense categories
- inventory items
- integration sources
- field mappings
- validation settings

### 5. Correction/audit completion

- raw correction overlay
- reprocess after mapping correction
- audited stock correction after session lock
- reversal/repost after sales-source correction once sales journal exists

### 6. Reports/exports

- weekly/monthly report
- CSV
- XLSX
- filter parity tests

### 7. Release test suite

Create automated tests for:

- auth/RBAC
- Google webhook HMAC/replay/idempotency
- cashier normalizer
- sales normalizer
- finance journals
- PR state machine
- stock state machine
- correction/void
- daily closing
- incomplete email
- PWA offline safety where practical

## Useful source entry points

- auth: `src/auth.ts`
- authorization: `src/lib/auth/`
- schema: `src/db/schema/`
- migrations: `src/db/migrations/`
- reporting views: `src/db/views/`
- Google ingestion: `src/modules/integration/`
- finance: `src/modules/finance/`
- purchase: `src/modules/purchase/`
- inventory: `src/modules/inventory/`
- corrections: `src/modules/correction/`
- reporting: `src/modules/reporting/`
- PWA: `public/sw.js`, `src/app/manifest.ts`, `src/components/pwa/`

## Handoff truth rule

If an old implementation-status note conflicts with current source code, current source code is the implementation truth. If current source conflicts with the SRS/SDD business intent, preserve data/history and fix implementation toward the approved design rather than silently changing the requirement.
