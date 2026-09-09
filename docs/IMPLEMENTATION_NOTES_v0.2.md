# Implementation Notes v0.2

## Source authority
- SRS: business behavior and acceptance.
- ERD: logical entities/relationships/integrity direction.
- SDD: technical architecture and runtime behavior.
- UI/UX: visual behavior and role navigation.

## Known source conflicts resolved explicitly for v0.2

### Raw submission uniqueness
ERD v0.1 says `UNIQUE(data_source_id, source_record_key)`; SDD v0.1 later requires same row + different hash to become a new raw revision. Physical v0.2 follows the SDD behavior and therefore uses revisioned uniqueness plus payload-hash deduplication.

### Audit source labels
ERD uses `WEB/SYNC/JOB`; SDD audit structure uses `WEB/GOOGLE_SCRIPT/SYSTEM`. Physical v0.2 uses the latter and treats SYNC/JOB as legacy conceptual labels.

### Purchase status labels
SDD's state machine is used as the canonical stored state. UI labels such as "Awaiting Approval" or "Completed" are display labels mapped onto those stored states.

### Sales Clearing account type
ERD allows only ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE while SDD Appendix B describes Sales Clearing as type "Clearing". Physical v0.2 keeps `account_type` inside the ERD set and adds `account_subtype`; Sales Clearing is provisionally `LIABILITY / CLEARING` pending accounting sign-off.

## PWA security rule
The service worker never caches API responses or authenticated financial HTML for offline reuse. Static application assets may be cached. When navigation fails offline, the user sees the generic offline page. Financial mutations are not queued.
