# Current Implementation Status — v0.9.0-handoff

## Status legend

- **Implemented**: source is present in this ZIP.
- **Partial**: meaningful source exists, but production hardening/test coverage is incomplete.
- **Pending**: should be continued in Codex.
- **Blocked verification**: source exists, but real build/runtime was not certified in the original environment.

## Platform/foundation

| Area | Status | Notes |
|---|---|---|
| Next.js modular monolith | Implemented | App Router source tree present. |
| PostgreSQL/Drizzle schema | Implemented | Baseline schema plus handoff migration. |
| Ordered SQL bootstrap | Implemented | Applies all migrations/views/seeds by filename. |
| Google OAuth allowlist | Implemented | Login allowed only for active DB users. |
| Server-side RBAC | Implemented | Role-permission model and route/service checks. |
| PWA manifest | Implemented | Dopamin branding baseline. |
| PWA service worker | Implemented | No API/mutation cache; opt-in update activation. |
| Health endpoint | Implemented | `/api/health`. |
| Static verifier | Implemented | `npm run verify:static`. |
| DB smoke test | Implemented | `npm run db:smoke` after real DB exists. |
| Dependency-aware build | Blocked verification | Must be run in Codex. |

## Integration

| Area | Status | Notes |
|---|---|---|
| HMAC Form webhook | Implemented | Cashier/Kitchen/Beverage live source path. |
| Raw payload retention | Implemented | JSONB raw submissions. |
| Payload idempotency | Implemented | source/row/hash handling. |
| Raw revisioning | Partial | changed row creates revision; acceptance/reprocess semantics need hardening. |
| Field mappings | Implemented baseline | DB-driven normalizer mappings. |
| User source aliases | Implemented in handoff | table/schema, normalizer resolution, Settings manager. |
| Reprocess after mapping fix | Pending | priority Codex item. |
| Raw-source correction overlay | Pending | preserve raw evidence. |
| Validation thresholds | Pending | do not invent values. |

## Operational modules

| Module | Status | Notes |
|---|---|---|
| Dashboard | Implemented | real reporting-view queries. |
| Sales read screens | Implemented in handoff | overview/detail; role scope. |
| Cashier read screens | Implemented in handoff | payment/expense/count detail; expected cash intentionally TBD. |
| Finance write service | Implemented | funding/transfer/expense + journal + audit. |
| Finance read screens | Implemented in handoff | balances/history/journal linkage. |
| Purchase Request | Implemented baseline | create/submit/approve/revise/reject/funding/spend/receipt/close. |
| Inventory Stock Opname | Implemented baseline | role scope, draft lines, submit/review. |
| Post-lock stock correction | Pending | must be audited correction flow. |
| Daily reports | Implemented baseline | snapshot, recipients, delivery, resend/revision. |
| Data Issues | Implemented baseline | queue/API. |
| Normalized corrections | Implemented baseline | supported fields with audit. |
| Audit read screens | Implemented in handoff | list/detail; limited scope needs UAT review. |
| Settings daily report | Implemented baseline | schedule/recipient form/API. |
| Settings source aliases | Implemented in handoff | user alias mapping. |
| Full master admin | Pending | users/menu/prices/payment/expense/inventory/mappings. |

## Accounting

| Area | Status | Notes |
|---|---|---|
| Company funding journal | Implemented | Housebank debit + configured funding account credit. |
| Internal transfer journal | Implemented | asset transfer. |
| Operational expense journal | Implemented | expense debit + fund credit. |
| Financial VOID/reversal | Implemented baseline | history retained. |
| Daily Sales Clearing posting | Pending | implement from SDD after reconciliation policy. |
| Journal reporting UI | Partial | finance transaction detail shows lines; standalone accounting module pending. |
| Correction-driven sales reversal/repost | Pending | dependent on Sales Clearing implementation. |

## Reporting/data quality

| Area | Status | Notes |
|---|---|---|
| Daily completeness | Implemented + hardened | all current source reports must be VALID. |
| Management reporting view | Implemented | Food/Beverage/payment/expense/Housebank. |
| BELUM LENGKAP behavior | Implemented baseline | scheduled daily snapshot flow. |
| Weekly/monthly management report | Pending | Codex. |
| CSV/XLSX export | Pending | Codex. |

## Explicit unresolved business decisions

- expected closing cash / petty cash formula
- final Company Funding accounting classification
- DP/Promotion/Receivable daily sales accounting treatment

## Verification needed in Codex

```bash
npm install
npm run verify:static
npm run typecheck
npm run build
npm run db:bootstrap
npm run db:smoke
npm run dev
```

Then perform real OAuth, Google Apps Script, and UAT flows.
