BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(32) NOT NULL UNIQUE,
  name varchar(80) NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(80) NOT NULL UNIQUE,
  name varchar(160) NOT NULL
);

CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE RESTRICT,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  email varchar(320) NOT NULL UNIQUE,
  full_name varchar(160) NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE data_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(40) NOT NULL UNIQUE,
  source_type varchar(24) NOT NULL CHECK (source_type IN ('FORM','SHEET_IMPORT')),
  spreadsheet_id varchar(255),
  sheet_name varchar(255),
  is_required_daily boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE source_field_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_source_id uuid NOT NULL REFERENCES data_sources(id) ON DELETE RESTRICT,
  source_field_name varchar(255) NOT NULL,
  mapping_type varchar(60) NOT NULL,
  target_key varchar(160) NOT NULL,
  mapping_version integer NOT NULL DEFAULT 1 CHECK (mapping_version >= 1),
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (data_source_id, source_field_name, mapping_version)
);

CREATE TABLE raw_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_source_id uuid NOT NULL REFERENCES data_sources(id) ON DELETE RESTRICT,
  source_record_key varchar(255) NOT NULL,
  source_revision integer NOT NULL DEFAULT 1 CHECK (source_revision >= 1),
  supersedes_submission_id uuid REFERENCES raw_submissions(id) ON DELETE RESTRICT,
  submitted_at timestamptz NOT NULL,
  business_date_detected date,
  payload_hash varchar(128) NOT NULL,
  raw_payload jsonb NOT NULL,
  processing_status varchar(32) NOT NULL DEFAULT 'RECEIVED'
    CHECK (processing_status IN ('RECEIVED','PROCESSING','VALID','NEEDS_REVIEW','ERROR','SUPERSEDED')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (data_source_id, source_record_key, source_revision),
  UNIQUE (data_source_id, source_record_key, payload_hash)
);
CREATE INDEX raw_submissions_processing_idx ON raw_submissions(processing_status, first_seen_at);

CREATE TABLE sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_source_id uuid NOT NULL REFERENCES data_sources(id) ON DELETE RESTRICT,
  trigger_type varchar(32) NOT NULL CHECK (trigger_type IN ('WEBHOOK','REPLAY','RECONCILIATION','MANUAL')),
  status varchar(24) NOT NULL CHECK (status IN ('RUNNING','SUCCESS','PARTIAL','FAILED')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE data_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_submission_id uuid REFERENCES raw_submissions(id) ON DELETE RESTRICT,
  module varchar(40) NOT NULL,
  severity varchar(16) NOT NULL CHECK (severity IN ('INFO','WARNING','CRITICAL')),
  issue_code varchar(80) NOT NULL,
  field_name varchar(255),
  message text NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED','IGNORED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX data_issues_status_idx ON data_issues(status, severity, created_at DESC);

CREATE TABLE chart_of_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  code varchar(40) NOT NULL UNIQUE,
  name varchar(160) NOT NULL,
  account_type varchar(24) NOT NULL CHECK (account_type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')),
  account_subtype varchar(40),
  description text
);

CREATE TABLE payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_account_id uuid NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  code varchar(60) NOT NULL UNIQUE,
  name varchar(120) NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_account_id uuid NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  code varchar(60) NOT NULL UNIQUE,
  name varchar(160) NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revenue_account_id uuid NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  code varchar(80) NOT NULL UNIQUE,
  name varchar(160) NOT NULL,
  category varchar(16) NOT NULL CHECK (category IN ('FOOD','BEVERAGE')),
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE menu_price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id uuid NOT NULL REFERENCES menu_items(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  price numeric(18,2) NOT NULL CHECK (price >= 0),
  effective_from date NOT NULL,
  effective_to date,
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX menu_price_history_lookup_idx ON menu_price_history(menu_item_id, effective_from DESC);
ALTER TABLE menu_price_history ADD CONSTRAINT menu_price_history_no_overlap
  EXCLUDE USING gist (
    menu_item_id WITH =,
    daterange(effective_from, COALESCE(effective_to + 1, 'infinity'::date), '[)') WITH &&
  );

CREATE TABLE fund_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coa_account_id uuid NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  code varchar(60) NOT NULL UNIQUE,
  name varchar(160) NOT NULL,
  account_type varchar(40) NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE cashier_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_submission_id uuid NOT NULL UNIQUE REFERENCES raw_submissions(id) ON DELETE RESTRICT,
  cashier_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  business_date date NOT NULL,
  cashier_name_raw varchar(160),
  shift_code varchar(40),
  transaction_type varchar(80),
  opening_closing_status varchar(80),
  petty_cash_amount numeric(18,2) CHECK (petty_cash_amount IS NULL OR petty_cash_amount >= 0),
  cash_outside_petty_amount numeric(18,2) CHECK (cash_outside_petty_amount IS NULL OR cash_outside_petty_amount >= 0),
  report_status varchar(32) NOT NULL DEFAULT 'VALID'
);
CREATE INDEX cashier_reports_daily_idx ON cashier_reports(business_date, shift_code, report_status);

CREATE TABLE payment_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cashier_report_id uuid NOT NULL REFERENCES cashier_reports(id) ON DELETE RESTRICT,
  payment_method_id uuid NOT NULL REFERENCES payment_methods(id) ON DELETE RESTRICT,
  amount numeric(18,2) NOT NULL CHECK (amount >= 0),
  source_field varchar(255) NOT NULL
);
CREATE INDEX payment_lines_method_idx ON payment_lines(payment_method_id, cashier_report_id);

CREATE TABLE cashier_expense_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cashier_report_id uuid NOT NULL REFERENCES cashier_reports(id) ON DELETE RESTRICT,
  expense_category_id uuid REFERENCES expense_categories(id) ON DELETE RESTRICT,
  amount numeric(18,2) NOT NULL CHECK (amount >= 0),
  staff_name_raw varchar(160),
  description text,
  source_field varchar(255)
);

CREATE TABLE cash_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cashier_report_id uuid NOT NULL REFERENCES cashier_reports(id) ON DELETE RESTRICT,
  denomination_amount numeric(18,2) NOT NULL CHECK (denomination_amount > 0),
  quantity integer NOT NULL CHECK (quantity >= 0),
  source_field varchar(255) NOT NULL,
  UNIQUE (cashier_report_id, denomination_amount)
);

CREATE TABLE sales_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_submission_id uuid NOT NULL UNIQUE REFERENCES raw_submissions(id) ON DELETE RESTRICT,
  inputter_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  report_type varchar(16) NOT NULL CHECK (report_type IN ('FOOD','BEVERAGE')),
  business_date date NOT NULL,
  inputter_name_raw varchar(160),
  report_status varchar(32) NOT NULL DEFAULT 'VALID'
);
CREATE INDEX sales_reports_daily_idx ON sales_reports(business_date, report_type, report_status);

CREATE TABLE sales_report_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_report_id uuid NOT NULL REFERENCES sales_reports(id) ON DELETE RESTRICT,
  menu_item_id uuid NOT NULL REFERENCES menu_items(id) ON DELETE RESTRICT,
  menu_price_history_id uuid REFERENCES menu_price_history(id) ON DELETE RESTRICT,
  quantity numeric(18,3) NOT NULL CHECK (quantity >= 0),
  unit_price_snapshot numeric(18,2) NOT NULL CHECK (unit_price_snapshot >= 0),
  source_field varchar(255) NOT NULL,
  UNIQUE (sales_report_id, menu_item_id)
);
CREATE INDEX sales_report_items_menu_idx ON sales_report_items(menu_item_id, sales_report_id);

CREATE TABLE purchase_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_fund_account_id uuid REFERENCES fund_accounts(id) ON DELETE RESTRICT,
  request_no varchar(80) NOT NULL UNIQUE,
  request_date date NOT NULL,
  purpose text NOT NULL,
  estimated_total numeric(18,2) NOT NULL CHECK (estimated_total >= 0),
  status varchar(40) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','FUNDED_READY_TO_SPEND','PURCHASED','RECEIPT_RECORDED','CLOSED','REVISION_REQUESTED','REJECTED'))
);

CREATE TABLE purchase_request_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_request_id uuid NOT NULL REFERENCES purchase_requests(id) ON DELETE RESTRICT,
  item_name varchar(200) NOT NULL,
  quantity numeric(18,3) NOT NULL CHECK (quantity > 0),
  unit varchar(40) NOT NULL,
  estimated_unit_cost numeric(18,2) NOT NULL CHECK (estimated_unit_cost >= 0)
);

CREATE TABLE purchase_request_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_request_id uuid NOT NULL REFERENCES purchase_requests(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action varchar(32) NOT NULL CHECK (action IN ('SUBMIT','APPROVE','REVISE','REJECT','CLOSE')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE fund_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_fund_account_id uuid REFERENCES fund_accounts(id) ON DELETE RESTRICT,
  destination_fund_account_id uuid REFERENCES fund_accounts(id) ON DELETE RESTRICT,
  expense_category_id uuid REFERENCES expense_categories(id) ON DELETE RESTRICT,
  purchase_request_id uuid REFERENCES purchase_requests(id) ON DELETE RESTRICT,
  source_submission_id uuid REFERENCES raw_submissions(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  transaction_no varchar(80) NOT NULL UNIQUE,
  business_date date NOT NULL,
  transaction_type varchar(32) NOT NULL CHECK (transaction_type IN ('EXTERNAL_FUNDING','INTERNAL_TRANSFER','EXPENSE','OPENING_BALANCE','ADJUSTMENT')),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  description text,
  counterparty_name varchar(160),
  reference_no varchar(160),
  receipt_reference text,
  status varchar(16) NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED','VOID')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fund_transactions_direction_ck CHECK (
    (transaction_type = 'EXTERNAL_FUNDING' AND source_fund_account_id IS NULL AND destination_fund_account_id IS NOT NULL AND expense_category_id IS NULL)
    OR (transaction_type = 'INTERNAL_TRANSFER' AND source_fund_account_id IS NOT NULL AND destination_fund_account_id IS NOT NULL AND source_fund_account_id <> destination_fund_account_id AND expense_category_id IS NULL)
    OR (transaction_type = 'EXPENSE' AND source_fund_account_id IS NOT NULL AND destination_fund_account_id IS NULL AND expense_category_id IS NOT NULL)
    OR (transaction_type = 'OPENING_BALANCE' AND source_fund_account_id IS NULL AND destination_fund_account_id IS NOT NULL)
    OR (transaction_type = 'ADJUSTMENT' AND (source_fund_account_id IS NOT NULL OR destination_fund_account_id IS NOT NULL))
  )
);
CREATE INDEX fund_transactions_daily_idx ON fund_transactions(business_date, status);
CREATE INDEX fund_transactions_accounts_idx ON fund_transactions(source_fund_account_id, destination_fund_account_id);

CREATE TABLE purchase_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_request_id uuid NOT NULL REFERENCES purchase_requests(id) ON DELETE RESTRICT,
  fund_transaction_id uuid REFERENCES fund_transactions(id) ON DELETE RESTRICT,
  uploaded_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  storage_provider varchar(60) NOT NULL,
  storage_file_id varchar(255) NOT NULL,
  file_url text NOT NULL
);

CREATE TABLE journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reversed_entry_id uuid REFERENCES journal_entries(id) ON DELETE RESTRICT,
  entry_no varchar(80) NOT NULL UNIQUE,
  business_date date NOT NULL,
  source_type varchar(60) NOT NULL,
  source_id uuid NOT NULL,
  description text NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED','VOID'))
);
CREATE UNIQUE INDEX journal_entries_posted_source_uq ON journal_entries(source_type, source_id) WHERE status='POSTED';

CREATE TABLE journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id uuid NOT NULL REFERENCES journal_entries(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  debit numeric(18,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(18,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  memo text,
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);

CREATE TABLE inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku varchar(80) UNIQUE,
  name varchar(160) NOT NULL,
  category varchar(16) NOT NULL CHECK (category IN ('KITCHEN','BAR','OTHER')),
  unit varchar(40) NOT NULL,
  minimum_stock numeric(18,3) CHECK (minimum_stock IS NULL OR minimum_stock >= 0),
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE stock_opname_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  responsible_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  business_date date NOT NULL,
  category varchar(16) NOT NULL CHECK (category IN ('KITCHEN','BAR','OTHER')),
  status varchar(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','REVIEWED')),
  submitted_at timestamptz
);
CREATE INDEX stock_opname_sessions_daily_idx ON stock_opname_sessions(business_date, category, status);

CREATE TABLE stock_opname_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES stock_opname_sessions(id) ON DELETE RESTRICT,
  inventory_item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  reference_qty numeric(18,3) CHECK (reference_qty IS NULL OR reference_qty >= 0),
  actual_qty numeric(18,3) NOT NULL CHECK (actual_qty >= 0),
  note text,
  UNIQUE (session_id, inventory_item_id)
);

CREATE TABLE daily_closings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  closed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  business_date date NOT NULL UNIQUE,
  status varchar(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','INCOMPLETE','RECONCILED','CLOSED')),
  cashier_complete boolean NOT NULL DEFAULT false,
  kitchen_complete boolean NOT NULL DEFAULT false,
  beverage_complete boolean NOT NULL DEFAULT false,
  payment_total_snapshot numeric(18,2),
  sales_total_snapshot numeric(18,2),
  sales_payment_difference numeric(18,2),
  cash_variance_snapshot numeric(18,2)
);

CREATE TABLE daily_report_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  updated_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT false,
  send_time time NOT NULL,
  timezone varchar(64) NOT NULL DEFAULT 'Asia/Jakarta',
  incomplete_behavior varchar(32) NOT NULL DEFAULT 'SEND_INCOMPLETE' CHECK (incomplete_behavior = 'SEND_INCOMPLETE'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE daily_report_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settings_id uuid NOT NULL REFERENCES daily_report_settings(id) ON DELETE RESTRICT,
  email varchar(320) NOT NULL,
  recipient_name varchar(160),
  is_enabled boolean NOT NULL DEFAULT true,
  UNIQUE (settings_id, email)
);

CREATE TABLE daily_report_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_closing_id uuid REFERENCES daily_closings(id) ON DELETE RESTRICT,
  parent_run_id uuid REFERENCES daily_report_runs(id) ON DELETE RESTRICT,
  triggered_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  business_date date NOT NULL,
  revision_no integer NOT NULL DEFAULT 0 CHECK (revision_no >= 0),
  trigger_type varchar(16) NOT NULL CHECK (trigger_type IN ('SCHEDULED','MANUAL','REVISION')),
  completeness_status varchar(16) NOT NULL CHECK (completeness_status IN ('COMPLETE','INCOMPLETE')),
  metrics_snapshot jsonb NOT NULL,
  missing_sources jsonb NOT NULL,
  status varchar(24) NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_date, revision_no)
);

CREATE TABLE daily_report_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_run_id uuid NOT NULL REFERENCES daily_report_runs(id) ON DELETE RESTRICT,
  recipient_email varchar(320) NOT NULL,
  delivery_status varchar(24) NOT NULL CHECK (delivery_status IN ('PENDING','SENT','FAILED','UNKNOWN')),
  sent_at timestamptz,
  error_message text
);

CREATE TABLE data_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  entity_type varchar(80) NOT NULL,
  entity_id uuid NOT NULL,
  reason text NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUPERSEDED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE data_correction_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correction_id uuid NOT NULL REFERENCES data_corrections(id) ON DELETE RESTRICT,
  field_name varchar(160) NOT NULL,
  old_value jsonb NOT NULL,
  new_value jsonb NOT NULL
);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  actor_role varchar(40),
  action varchar(64) NOT NULL,
  module varchar(40) NOT NULL,
  entity_type varchar(80) NOT NULL,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  reason text,
  source varchar(24) NOT NULL CHECK (source IN ('WEB','GOOGLE_SCRIPT','SYSTEM')),
  correlation_id varchar(100),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs(created_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs(entity_type, entity_id);
CREATE INDEX audit_logs_actor_idx ON audit_logs(actor_user_id, created_at DESC);

CREATE TABLE system_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  updated_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  setting_key varchar(120) NOT NULL UNIQUE,
  value_json jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
