# Release Checklist — Dopamin Cafe

## Verification provenance - 2026-09-09

Install, bootstrap and Owner OAuth/login were verified by the stakeholder before this task. Typecheck/build/DB smoke were repeated via equivalent installed entry points because npm wrappers could not launch in this shell. No production deployment or actual Sheet ingestion was performed. See IMPLEMENTATION_STATUS_CURRENT.md for exact limits.

## Build and source

- [x] `npm install` succeeds
- [x] package lock generated and committed
- [x] `npm run verify:static` passes
- [x] `npm run typecheck` passes
- [x] `npm run build` passes
- [ ] no production secret committed

## Database

- [x] fresh PostgreSQL database provisioned
- [x] `npm run db:bootstrap` passes
- [x] `npm run db:smoke` passes
- [ ] migration rerun behavior understood for target environment
- [ ] backup created
- [ ] backup restore tested into a separate database

## Master data

- [x] Owner created
- [ ] Director/Manager/Cashier/Kitchen users configured
- [ ] source aliases configured
- [ ] actual Spreadsheet IDs / sheet names configured
- [ ] field mappings configured
- [ ] Food menu configured
- [ ] Beverage menu configured
- [ ] effective prices configured
- [ ] expense categories configured
- [ ] inventory items configured
- [ ] report schedule configured
- [ ] report recipients configured

## Authentication / RBAC

- [x] Owner login
- [ ] Director login
- [ ] Manager login
- [ ] Cashier login
- [ ] Kitchen login
- [ ] deactivated user denied
- [ ] server-side permission tests for finance/settings/audit
- [ ] own-source Cashier/Kitchen tests

## Local regression evidence

- [x] Empty sales interval executes all three real PostgreSQL queries
- [x] Five-role sales SQL scope tests
- [x] Health 200 and protected-route login redirects
- [x] Unsigned webhook rejected locally
- [x] HMAC tamper/expiry and Apps Script payload/date/header/retry/cursor tests locally
- [x] Synthetic DB ingestion/reprocess/raw-retention/failure/audit regression (rollback-only; actual Google UAT still open)
- [ ] Authenticated Owner `/sales` browser retest after this fix

## Google integration (actual Google UAT still required)

- [ ] Cashier onFormSubmit succeeds
- [ ] Kitchen onFormSubmit succeeds
- [ ] Beverage onFormSubmit succeeds
- [ ] explicit Beverage Business Date validated
- [ ] invalid HMAC rejected
- [ ] old/replayed signed timestamp rejected as designed
- [ ] duplicate payload is idempotent
- [ ] changed source row creates controlled revision
- [ ] reconciliation replay safe

## Finance/accounting

- [ ] Company → Housebank funding transaction correct
- [ ] funding does not increase sales revenue
- [ ] Housebank → Cashier transfer correct
- [ ] internal transfer does not hit P&L
- [ ] Housebank expense correct
- [ ] Cashier expense correct where applicable
- [ ] posted journals balance
- [ ] VOID/reversal preserves history
- [ ] unresolved Company Funding classification approved before final accounting sign-off
- [ ] Sales Clearing implemented/tested before enabling daily sales journal posting

## Cashier / sales

- [ ] duplicate branch payment columns normalize correctly
- [ ] Cashier user aliases resolve
- [ ] Kitchen inputter aliases resolve
- [ ] Beverage inputter aliases resolve
- [ ] missing alias creates review issue
- [ ] menu price resolves by Business Date
- [ ] future price change does not rewrite historical revenue
- [ ] expected closing cash formula approved before enabling variance as authoritative

## Purchase Request

- [ ] draft
- [ ] submit
- [ ] approve
- [ ] revision
- [ ] reject
- [ ] funding-source selection
- [ ] actual spend
- [ ] receipt record
- [ ] close
- [ ] rejected/revision request cannot improperly spend

## Inventory

- [ ] Kitchen category scope
- [ ] Bar category scope
- [ ] Other category scope
- [ ] submit locks session
- [ ] review locks session
- [ ] variance derives from actual-reference
- [ ] audited post-lock correction implemented/tested before production use

## Reporting

- [ ] daily completeness works with all VALID
- [ ] one NEEDS_REVIEW row keeps source incomplete
- [ ] complete daily email
- [ ] incomplete daily email says BELUM LENGKAP
- [ ] recipients correct
- [ ] send-time correct in Asia/Jakarta
- [ ] duplicate scheduler heartbeat does not duplicate run
- [ ] resend creates revision rather than overwriting original

## PWA

- [ ] manifest valid
- [ ] install tested Android
- [ ] install tested iOS where applicable
- [ ] offline navigation shows generic offline page
- [ ] API responses not stored by service worker
- [ ] financial mutation not queued offline
- [ ] update banner appears for waiting worker
- [ ] update only activates after user action

## UAT / deployment

- [ ] staging URL configured
- [ ] real Google OAuth callback configured
- [ ] Apps Script production properties configured
- [ ] real business-day sample tested
- [ ] Owner/Director sign-off
- [ ] Manager workflow sign-off
- [ ] Cashier workflow sign-off
- [ ] Kitchen workflow sign-off
- [ ] backup/restore runbook accepted
- [ ] production monitoring/health check configured
