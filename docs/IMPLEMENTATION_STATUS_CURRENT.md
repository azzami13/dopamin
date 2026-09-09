# Current Implementation Status — 2026-09-10

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
| Dependency-aware build | Verified | Typecheck and full Next.js 16.3.4 production build pass. |

## Integration

| Area | Status | Notes |
|---|---|---|
| HMAC Form webhook | Implemented | Cashier/Kitchen/Beverage live source path. |
| Raw payload retention | Implemented | JSONB raw submissions. |
| Payload idempotency | Implemented | source/row/hash handling. |
| Raw revisioning | Hardened | Source lock; atomic normalization/replacement/audit/closing; failed normalization savepoint preserves raw evidence. Source-change acceptance and stale-event ordering remain backlog. |
| Field mappings | Implemented baseline | DB-driven normalizer mappings. |
| User source aliases | Implemented in handoff | table/schema, normalizer resolution, Settings manager. |
| Reprocess after mapping fix | Implemented API | Latest ERROR/NEEDS_REVIEW; SETTINGS_MANAGE + CORRECTION_CREATE; reason/audit and corrected/financial history guards; operator UI pending. |
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
| Daily completeness | Implemented + hardened | Service and view both require all current non-superseded reports VALID. |
| Management reporting view | Implemented | Food/Beverage/payment/expense/Housebank. |
| BELUM LENGKAP behavior | Implemented baseline | scheduled daily snapshot flow. |
| Weekly/monthly management report | Pending | Codex. |
| CSV/XLSX export | Pending | Codex. |

## Explicit unresolved business decisions

- expected closing cash / petty cash formula
- final Company Funding accounting classification
- DP/Promotion/Receivable daily sales accounting treatment

## Verification evidence and limits

Stakeholder verified before this task: npm install/dependencies, fresh bootstrap, DB smoke (40 tables/7 views), Neon connectivity, Owner creation, Auth.js v5 Google OAuth, Owner login/dashboard, typecheck and production build. These supersede the original blocked-install notes. The lockfile is tracked; this workspace uses `.env`.

| Current-session check | Result |
|---|---|
| Typecheck | PASS, installed TypeScript entry point |
| Full production build | PASS, Next.js 16.3.4 / Turbopack |
| DB smoke | PASS, 40 tables / 7 views and core invariants |
| Static artifacts/imports | PASS; optional global syntax parser skipped |
| Sales overview SQL | PASS: all three actual queries in Neon with DB Owner permission; empty interval returns empty results |
| Five sales role scopes | PASS locally; own-source predicate retained |
| HMAC / Apps Script mocks | PASS: UUID initialization/reuse across row movement, internal-column exclusion, lock reuse, required source schema, health error privacy/no-store, signing, expiry, payload parity, dates, headers, retry/cursor |
| Synthetic DB ingestion/reprocess | PASS on 2026-09-10: A -> B -> A creates revision 3 with a new ID; subsequent A is idempotent; temporary Google config and Business Date mapping are rolled back; replay, mapping rebuild, permission denial, supersession, raw retention, failure savepoint and audit; all fixtures rolled back |
| `/api/health` | PASS on 2026-09-10, live production build HTTP 200/no-store; error-detail suppression also unit-tested |
| Protected routes | PASS: dashboard/sales/cashier/finance redirect to login without session |
| Unsigned webhook | PASS, HTTP 401 |
| Authenticated Owner pages | NOT RETESTED; prior stakeholder verification retained |
| Actual Google Sheet / MailApp | NOT TESTED |

npm wrappers failed to launch in this shell. Equivalent installed package entry points were run directly; DB checks needed network-enabled execution. Direct dependency versions and root lockfile metadata are pinned to installed versions. Migration 0002 was applied alone to existing Neon on 2026-09-10: historical payload uniqueness was replaced with a nonunique index, retaining revision uniqueness. No raw rows, views, auth flow or secrets were changed; no bootstrap rerun or production deployment occurred.

## Integration readiness

Source configuration is mandatory for both webhook ingestion and reprocess. Latest-only idempotency supports A -> B -> A as three revisions and treats another current A as replay. DB smoke now detects adjacent duplicate hashes rather than valid historical repetitions.

The real DB has active CASHIER/KITCHEN/BEVERAGE sources, but Spreadsheet IDs/names are unset and there are zero active mappings/aliases. Supplied IDs/gids, exact missing information and setup instructions are centralized in `integrations/google-apps-script/README.md`. No live source configuration was changed.

Apps Script selects the configured gid, uses identical typed-cell payloads for live/replay, and supports bounded checkpointed backfill. Row identity is now a persisted UUID in hidden `__DOPAMIN_ROW_KEY`; original response fields remain untouched. Sorting/moving must include the full row and UUID. Previously imported numeric row keys require reconciliation before switching; pause/restart positional backfill after reordering. A metadata-only helper obtains exact sheet names/headers after manual Google setup.

Reprocess is restricted to incomplete, uncorrected, nonfinancial normalized rows. It preserves raw JSON/hash/revision and report IDs, audits prior normalized child values, regenerates issues/closings transactionally and rolls back on failure. Existing correction writes use the same source lock. General correction authorization review, raw overlays, mapping administration/version-attempt history and Sales Clearing reversal/repost remain backlog.

Not production-ready: actual-source setup/UAT, unresolved accounting policies, backup/restore, PWA UAT and deployment gates remain open.

The DB regression uses one owned rollback transaction instead of nesting service transaction wrappers inside a test transaction. Early harness attempts timed out; the final bounded run passed. Tagged abandoned test sessions were closed/rolled back. Concurrent multi-connection races are not covered by this synthetic test.

Post-test read-only checks on 2026-09-10 found zero legacy numeric row keys and zero temporary source configurations. Local Google Apps Script remains undeployed; initialize its internal UUID column manually before triggers/backfill. `next-env.d.ts` was generated by Next.js build, not patched manually in this task.
