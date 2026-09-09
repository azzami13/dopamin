BEGIN;

INSERT INTO roles (code, name, is_active) VALUES
('OWNER', 'Owner', true),
('DIRECTOR', 'Director', true),
('MANAGER', 'Manager', true),
('CASHIER', 'Cashier', true),
('KITCHEN', 'Kitchen', true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO permissions (code, name) VALUES
('DASHBOARD_EXECUTIVE_VIEW', 'View executive dashboard'),
('DASHBOARD_OPERATIONAL_VIEW', 'View operational dashboard'),
('SALES_VIEW', 'View sales reports'),
('CASHIER_VIEW', 'View cashier reports and reconciliation'),
('FINANCE_VIEW', 'View finance and fund accounts'),
('FINANCE_COMPANY_FUNDING', 'Create Company to Housebank funding'),
('FINANCE_TRANSFER', 'Create internal fund transfer'),
('FINANCE_EXPENSE', 'Create operational expense'),
('PURCHASE_VIEW', 'View purchase requests'),
('PURCHASE_CREATE', 'Create and manage purchase requests'),
('PURCHASE_APPROVE', 'Approve, revise, or reject purchase requests'),
('INVENTORY_VIEW', 'View inventory and stock opname'),
('INVENTORY_INPUT', 'Input stock opname within role scope'),
('STOCK_REVIEW', 'Review stock opname'),
('REPORT_VIEW', 'View historical reports'),
('DATA_ISSUE_VIEW', 'View data issues within authorized scope'),
('CORRECTION_CREATE', 'Create audited correction'),
('AUDIT_VIEW', 'View audit trail'),
('SETTINGS_MANAGE', 'Manage system settings'),
('USER_MANAGE', 'Manage application users'),
('MENU_MANAGE', 'Manage menu and effective prices'),
('EXPORT_DATA', 'Export permitted report data')
ON CONFLICT (code) DO NOTHING;

-- Owner and Director receive all baseline permissions.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('OWNER','DIRECTOR')
ON CONFLICT DO NOTHING;

-- Manager operational baseline. Entity/category scope is still enforced server-side.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'DASHBOARD_OPERATIONAL_VIEW','SALES_VIEW','CASHIER_VIEW','FINANCE_VIEW',
  'PURCHASE_VIEW','PURCHASE_CREATE','INVENTORY_VIEW','INVENTORY_INPUT','STOCK_REVIEW',
  'REPORT_VIEW','DATA_ISSUE_VIEW','CORRECTION_CREATE','EXPORT_DATA'
)
WHERE r.code = 'MANAGER'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'DASHBOARD_OPERATIONAL_VIEW','SALES_VIEW','CASHIER_VIEW','INVENTORY_VIEW','INVENTORY_INPUT','REPORT_VIEW','DATA_ISSUE_VIEW'
)
WHERE r.code = 'CASHIER'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'DASHBOARD_OPERATIONAL_VIEW','SALES_VIEW','INVENTORY_VIEW','INVENTORY_INPUT','REPORT_VIEW','DATA_ISSUE_VIEW'
)
WHERE r.code = 'KITCHEN'
ON CONFLICT DO NOTHING;

INSERT INTO chart_of_accounts (code, name, account_type, account_subtype, description) VALUES
('1001','Cashier Cash','ASSET','CASH','Operational money held at cashier'),
('1002','Housebank','ASSET','CASH','Operational fund receiving company funding'),
('1010','QRIS Clearing','ASSET','CLEARING','QRIS settlement clearing'),
('1011','Bank Transfer Clearing','ASSET','CLEARING','Bank transfer settlement clearing'),
('1012','Card Clearing','ASSET','CLEARING','Debit/credit card settlement clearing'),
('1100','Accounts Receivable / City Ledger','ASSET','RECEIVABLE','Receivable settlement classification'),
('2001','Customer Deposit / DP','LIABILITY','CUSTOMER_DEPOSIT','Customer deposits; not revenue until applied'),
('3001','Company Funding / Intercompany','EQUITY','INTERCOMPANY_FUNDING','Provisional classification; final accounting classification remains to be signed off'),
('4000','Sales Clearing','LIABILITY','CLEARING','Logical sales clearing account used to reconcile settlement versus Food/Beverage allocation'),
('4100','Food Sales Revenue','REVENUE','FOOD','Food revenue'),
('4200','Beverage Sales Revenue','REVENUE','BEVERAGE','Beverage revenue'),
('5000','Operational Expenses','EXPENSE','OPEX_PARENT','Parent operational expense account'),
('5099','Unmapped Operational Expense','EXPENSE','UNMAPPED','Temporary mapping until actual cafe expense categories are supplied')
ON CONFLICT (code) DO NOTHING;

INSERT INTO fund_accounts (coa_account_id, code, name, account_type, is_active)
SELECT id, 'HOUSEBANK', 'Housebank', 'CASH', true FROM chart_of_accounts WHERE code='1002'
ON CONFLICT (code) DO NOTHING;
INSERT INTO fund_accounts (coa_account_id, code, name, account_type, is_active)
SELECT id, 'CASHIER_CASH', 'Cashier Cash', 'CASH', true FROM chart_of_accounts WHERE code='1001'
ON CONFLICT (code) DO NOTHING;

INSERT INTO expense_categories (expense_account_id, code, name, is_active)
SELECT id, 'UNMAPPED', 'Belum Dipetakan', true FROM chart_of_accounts WHERE code='5099'
ON CONFLICT (code) DO NOTHING;

INSERT INTO payment_methods (settlement_account_id, code, name, is_active)
SELECT id, 'CASH', 'Cash', true FROM chart_of_accounts WHERE code='1001'
ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_methods (settlement_account_id, code, name, is_active)
SELECT id, 'QRIS', 'QRIS', true FROM chart_of_accounts WHERE code='1010'
ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_methods (settlement_account_id, code, name, is_active)
SELECT id, 'TRANSFER', 'Transfer', true FROM chart_of_accounts WHERE code='1011'
ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_methods (settlement_account_id, code, name, is_active)
SELECT id, 'DEBIT_CARD', 'Debit Card', true FROM chart_of_accounts WHERE code='1012'
ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_methods (settlement_account_id, code, name, is_active)
SELECT id, 'CREDIT_CARD_VISA', 'Credit Card - Visa', true FROM chart_of_accounts WHERE code='1012'
ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_methods (settlement_account_id, code, name, is_active)
SELECT id, 'CREDIT_CARD_MASTERCARD', 'Credit Card - Mastercard', true FROM chart_of_accounts WHERE code='1012'
ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_methods (settlement_account_id, code, name, is_active)
SELECT id, 'RECEIVABLE_CITY_LEDGER', 'Receivable / City Ledger', true FROM chart_of_accounts WHERE code='1100'
ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_methods (settlement_account_id, code, name, is_active)
SELECT id, 'DP', 'DP / Customer Deposit', true FROM chart_of_accounts WHERE code='2001'
ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_methods (settlement_account_id, code, name, is_active)
SELECT id, 'PROMOTION_COOPERATION', 'Promotion / Cooperation', true FROM chart_of_accounts WHERE code='1100'
ON CONFLICT (code) DO NOTHING;

INSERT INTO data_sources (code, source_type, is_required_daily, is_active) VALUES
('CASHIER','FORM',true,true),
('KITCHEN','FORM',true,true),
('BEVERAGE','FORM',true,true),
('OPEX','SHEET_IMPORT',false,true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO system_settings (setting_key, value_json) VALUES
('business.timezone', '"Asia/Jakarta"'::jsonb),
('business.operating_hours', '{"open":"10:00","close":"21:30"}'::jsonb),
('pwa.financial_offline_mutations', 'false'::jsonb)
ON CONFLICT (setting_key) DO NOTHING;

COMMIT;
