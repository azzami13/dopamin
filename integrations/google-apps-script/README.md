# Google Apps Script integration

Local source only: this project has not been deployed to Google or tested against the actual response Sheets.

## Existing architecture

Google Sheet -> Apps Script -> signed webhook -> `raw_submissions` -> normalizer -> `cashier_reports` / `sales_reports` -> PostgreSQL views -> dashboard.

Google Sheets retains raw operational evidence. The dashboard queries PostgreSQL, never Google Sheets.

## Source configuration supplied by stakeholder

| Source | Spreadsheet ID | gid | Exact sheet name |
|---|---|---|---|
| CASHIER | `1qxfPS1ZNsTydzRrl0hhBZRckrqmlose2BoGYOPpoXBk` | `1225450098` | Required |
| KITCHEN | `1y1gwIbSvill7PUbDjfdVT1iUnveAUgXyQOVwsvTNhvI` | `2005487655` | Required |
| BEVERAGE | `1eAiqAIiJ_-XeyRjdXeuJqzOlbOCLAA1yYTZ9zgrwD5w` | `539201770` | Required |

Keep the backend allowlist in `data_sources.spreadsheet_id` and `sheet_name`. Do not hardcode these IDs in application queries or normalizers. The read-only DB check on 2026-09-09 found all three sources active, with IDs/names unset, zero active field mappings and zero active aliases. No live DB configuration was changed in this task.

## Manual Google setup (not performed)

1. Use a separate Apps Script project/configuration per response spreadsheet/source. Add local `Code.gs`.
2. Set Script Properties:
   - `DOPAMIN_BASE_URL`: reachable HTTPS application origin.
   - `DOPAMIN_INTEGRATION_SECRET`: same value as backend `GOOGLE_INTEGRATION_SECRET`; never place in cells or logs.
   - `DOPAMIN_SOURCE_KEY`: CASHIER, KITCHEN, or BEVERAGE.
   - `DOPAMIN_SPREADSHEET_ID`: corresponding spreadsheet above.
   - `DOPAMIN_SHEET_ID`: numeric gid above, stored as a string.
   - `DOPAMIN_REPLAY_ROWS`: optional batch limit 1..100, default 50.
3. Set project timezone to Asia/Jakarta. Row serialization explicitly uses Asia/Jakarta.
4. Run `describeConfiguredSource()` manually and inspect its returned metadata to obtain the exact sheet name and headers. It does not send rows or return response values/secrets. Configure that exact name and ID in backend `data_sources` before ingestion.
5. Confirm the first column contains a typed Form timestamp, date-only business fields are typed dates or supported date strings, and headers are unique/nonblank. Duplicate headers are rejected rather than silently overwriting evidence.
6. Configure actual mappings, aliases, menus and effective prices. Obtain representative anonymized response rows including branch/blank cases before deciding mappings. No actual mappings or prices are supplied by this code.
7. Confirm response tabs remain append-only: do not sort, insert, delete, or move rows. The existing `rowKey = row number` contract is stable for edits/retries/backfill only under that condition. Use filter views or a separate reporting tab. If staff must reorder response rows, a persistent identity migration is required before ingestion; do not silently switch key formats on imported data.
8. Create an installable spreadsheet **On form submit** trigger for `onFormSubmit`. Events from other configured tabs are ignored.
9. Test one actual Cashier row, duplicate delivery and changed-row revision before bulk import. Verify raw evidence, Business Date, mapping, aliases and normalized totals.
10. Run `backfillRows()` repeatedly (or by timer). Each run sends up to the configured batch size and stops near four minutes. The per-source/spreadsheet/gid cursor advances only after accepted delivery. It skips wholly empty rows. HTTP/network failures retain the failed row for retry; 429/5xx/network failures receive up to three attempts with backoff. Authentication/configuration failures stop immediately. Remove that source's `DOPAMIN_BACKFILL_NEXT_ROW_...` property only to intentionally restart from row 2; backend idempotency handles duplicates.
11. Optionally schedule `replayRecentRows()` for a bounded recent window. It uses the configured gid, never the active tab.

Neither function modifies response cells. Live and replay both read typed cell values; `namedValues` is not used because its display strings previously produced different payload hashes. Column 1 timestamps include the offset; other Date cells serialize as `YYYY-MM-DD` for Business Date. A missing/invalid timestamp stops delivery instead of inventing the current time.

## Signing and backend integrity

HMAC-SHA256 signs the Unix timestamp + `.` + exact JSON body. The backend requires integer timestamps within 300 seconds and compares signatures in constant time. Unsigned requests remain rejected. Requests replayed inside the window are made harmless by payload idempotency; this is not a one-use nonce scheme. Configured spreadsheet ID/name must match, including rejecting missing values when configured.

Payload identity is source + row key + stable hash of the payload (transport timestamps are excluded). Duplicate hashes remain no-ops, including hashes of historical superseded revisions; replaying an old payload does not reactivate historical data. A real source change creates a linked raw revision. Transaction-scoped advisory locks serialize writes per configured source; normalization, replacement, status, audit and closing evaluation commit together. A failed normalization rolls back its partial writes to a savepoint, retains the new raw payload as ERROR and flags earlier current reports NEEDS_REVIEW. No original raw JSON is overwritten/deleted.

HTTP 2xx with `data.status = ERROR` means raw evidence was retained but processing failed; Apps Script stops without advancing the cursor. A repeat of stored ERROR/PROCESSING returns `REPROCESS_REQUIRED`. Fix master/mapping errors and use controlled reprocessing before retrying the cursor. UNKNOWN business policy is never solved by inventing prices or journal treatment.

## Mapping and controlled reprocess

Existing mapping types: BUSINESS_DATE, CASHIER_NAME, INPUTTER_NAME, SHIFT_CODE, TRANSACTION_TYPE, OPENING_CLOSING_STATUS, PETTY_CASH, CASH_OUTSIDE_PETTY, PAYMENT, EXPENSE, CASH_COUNT, SALE_ITEM. `IGNORE` explicitly documents reviewed metadata columns that do not normalize. Sales with any nonempty unmapped column remain NEEDS_REVIEW, so a partially mapped menu cannot silently become final.

Cashier Business Date: `Tanggal Pelaporan`. Kitchen: `Tanggal Penjualan` / `Tanggal penjualan`. Beverage requires explicit `Tanggal Penjualan`; never use the Form timestamp as its Business Date. Identity uses explicit active `user_source_aliases`, with no fuzzy matching. Sales snapshots use active menu items and price history effective on Business Date. Missing mappings/menus/prices/aliases create review issues and preserve raw evidence.

Authenticated endpoint:

```text
POST /api/integrations/submissions/{rawSubmissionId}/reprocess
Content-Type: application/json
{"reason":"Mapping/master correction reason"}
```

Requires both SETTINGS_MANAGE and CORRECTION_CREATE (Owner/Director in current seeds). Only the latest ERROR/NEEDS_REVIEW revision is eligible. Valid, superseded, corrected or financially linked reports are rejected. The operation reuses report IDs, rebuilds incomplete normalized child lines, retains the previous normalized values in an audit snapshot, resolves old open issues and creates any new issues, then recalculates affected daily closings in the same transaction. Raw JSON/hash/revision stay unchanged. Failure rolls back the reprocess. Existing correction writes use the same source lock to prevent a race with rebuilding.

This is an API operation, not a new Settings UI. Raw-source correction overlays, mapping administration UI/version-attempt history, stale-event ordering, arbitrary row movement, general own-source correction auditing, and Sales Clearing reversal/repost remain separate backlog items.

## Local validation

```text
node scripts/verify-integration.cjs
node scripts/verify-sales-db.cjs
node scripts/verify-ingestion-db.cjs
```

The first uses local mocks and checks SQL/role scope, HMAC, live/replay payload parity, date serialization, headers, retries and cursor progression. The second is read-only and executes the actual three sales overview queries against PostgreSQL for an empty interval. The third uses synthetic ingestion/reprocess fixtures in a transaction that always rolls back; it is not evidence of actual Google Sheet ingestion.

## Daily report heartbeat

Existing `dailyReportHeartbeat` remains available. Set `DOPAMIN_REPORT_JOB_SECRET` to the backend `REPORT_JOB_SECRET`, then configure a time-driven trigger (design recommendation about 15 minutes). The backend reserves the report snapshot; Apps Script sends via MailApp and posts signed delivery callbacks. Actual delivery remains untested in this task.
