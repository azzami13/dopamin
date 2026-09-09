# Google Apps Script integration

1. Attach `Code.gs` to each response spreadsheet or a shared Apps Script project.
2. Set Script Properties: `DOPAMIN_BASE_URL`, `DOPAMIN_INTEGRATION_SECRET`, `DOPAMIN_SOURCE_KEY` (`CASHIER`, `KITCHEN`, or `BEVERAGE`).
3. Set project timezone to Asia/Jakarta.
4. Create an installable `On form submit` trigger for `onFormSubmit`.
5. Optionally create a time-driven reconciliation trigger for `replayRecentRows` (for example hourly). Backend idempotency makes replay safe.
6. Configure `data_sources.spreadsheet_id`, `sheet_name`, then `source_field_mappings` before treating normalized data as production-ready.

The original Form Responses row is never modified by this script.

## Daily report heartbeat
Add Script Property `DOPAMIN_REPORT_JOB_SECRET` matching the server `REPORT_JOB_SECRET`, then create a time-driven trigger (recommended ~15 minutes) for `dailyReportHeartbeat`. The backend decides whether the configured report is due, reserves one immutable run, and returns an email payload. Apps Script sends via `MailApp` and posts a signed delivery callback per recipient.
