BEGIN;

CREATE OR REPLACE VIEW vw_daily_sales_summary AS
SELECT
  sr.business_date,
  sr.report_type,
  SUM(sri.quantity) AS total_quantity,
  SUM(sri.quantity * sri.unit_price_snapshot) AS revenue
FROM sales_reports sr
JOIN sales_report_items sri ON sri.sales_report_id = sr.id
WHERE sr.report_status = 'VALID'
GROUP BY sr.business_date, sr.report_type;

CREATE OR REPLACE VIEW vw_daily_payment_summary AS
SELECT
  cr.business_date,
  pm.code AS payment_method_code,
  pm.name AS payment_method_name,
  SUM(pl.amount) AS amount
FROM cashier_reports cr
JOIN payment_lines pl ON pl.cashier_report_id = cr.id
JOIN payment_methods pm ON pm.id = pl.payment_method_id
WHERE cr.report_status = 'VALID'
GROUP BY cr.business_date, pm.code, pm.name;

CREATE OR REPLACE VIEW vw_daily_cashier_expenses AS
SELECT
  cr.business_date,
  COALESCE(ec.code, 'UNMAPPED') AS expense_category_code,
  COALESCE(ec.name, 'Belum Dipetakan') AS expense_category_name,
  cel.staff_name_raw,
  SUM(cel.amount) AS amount
FROM cashier_reports cr
JOIN cashier_expense_lines cel ON cel.cashier_report_id = cr.id
LEFT JOIN expense_categories ec ON ec.id = cel.expense_category_id
WHERE cr.report_status = 'VALID'
GROUP BY cr.business_date, COALESCE(ec.code, 'UNMAPPED'), COALESCE(ec.name, 'Belum Dipetakan'), cel.staff_name_raw;

CREATE OR REPLACE VIEW vw_housebank_ledger AS
WITH hb AS (
  SELECT id FROM fund_accounts WHERE code = 'HOUSEBANK'
), movements AS (
  SELECT
    ft.id,
    ft.transaction_no,
    ft.business_date,
    ft.created_at,
    ft.transaction_type,
    ft.description,
    CASE WHEN ft.destination_fund_account_id = hb.id THEN ft.amount ELSE 0::numeric END AS amount_in,
    CASE WHEN ft.source_fund_account_id = hb.id THEN ft.amount ELSE 0::numeric END AS amount_out
  FROM fund_transactions ft
  CROSS JOIN hb
  WHERE ft.status = 'POSTED'
    AND (ft.source_fund_account_id = hb.id OR ft.destination_fund_account_id = hb.id)
)
SELECT
  id,
  transaction_no,
  business_date,
  created_at,
  transaction_type,
  description,
  amount_in,
  amount_out,
  SUM(amount_in - amount_out) OVER (ORDER BY business_date, created_at, id ROWS UNBOUNDED PRECEDING) AS running_balance
FROM movements;

CREATE OR REPLACE VIEW vw_cashier_cash_reconciliation_base AS
WITH receipts AS (
  SELECT cr.id AS cashier_report_id, COALESCE(SUM(pl.amount) FILTER (WHERE pm.code = 'CASH'), 0) AS cash_receipts
  FROM cashier_reports cr
  LEFT JOIN payment_lines pl ON pl.cashier_report_id = cr.id
  LEFT JOIN payment_methods pm ON pm.id = pl.payment_method_id
  GROUP BY cr.id
), counted AS (
  SELECT cashier_report_id, COALESCE(SUM(denomination_amount * quantity), 0) AS actual_counted_cash
  FROM cash_counts
  GROUP BY cashier_report_id
), expenses AS (
  SELECT cashier_report_id, COALESCE(SUM(amount), 0) AS cashier_expenses
  FROM cashier_expense_lines
  GROUP BY cashier_report_id
)
SELECT
  cr.id AS cashier_report_id,
  cr.business_date,
  cr.petty_cash_amount,
  cr.cash_outside_petty_amount,
  COALESCE(r.cash_receipts, 0) AS cash_receipts,
  COALESCE(e.cashier_expenses, 0) AS cashier_expenses,
  COALESCE(c.actual_counted_cash, 0) AS actual_counted_cash
FROM cashier_reports cr
LEFT JOIN receipts r ON r.cashier_report_id = cr.id
LEFT JOIN counted c ON c.cashier_report_id = cr.id
LEFT JOIN expenses e ON e.cashier_report_id = cr.id
WHERE cr.report_status = 'VALID';

COMMENT ON VIEW vw_cashier_cash_reconciliation_base IS
'Known cashier reconciliation components only. Final expected_closing_cash and variance are intentionally deferred until opening/petty-cash rules are finalized from the current cashier form/UAT, per SDD v0.1 section 7.4.';

CREATE OR REPLACE VIEW vw_daily_completeness AS
WITH dates AS (
  SELECT business_date FROM cashier_reports
  UNION
  SELECT business_date FROM sales_reports
), states AS (
  SELECT
    d.business_date,
    EXISTS (SELECT 1 FROM cashier_reports cr WHERE cr.business_date=d.business_date AND cr.report_status='VALID') AS cashier_complete,
    EXISTS (SELECT 1 FROM sales_reports sr WHERE sr.business_date=d.business_date AND sr.report_type='FOOD' AND sr.report_status='VALID') AS kitchen_complete,
    EXISTS (SELECT 1 FROM sales_reports sr WHERE sr.business_date=d.business_date AND sr.report_type='BEVERAGE' AND sr.report_status='VALID') AS beverage_complete
  FROM dates d
)
SELECT
  business_date,
  cashier_complete,
  kitchen_complete,
  beverage_complete,
  CASE WHEN cashier_complete AND kitchen_complete AND beverage_complete THEN 'COMPLETE' ELSE 'INCOMPLETE' END AS completeness_status
FROM states;

CREATE OR REPLACE VIEW vw_daily_management_report AS
WITH sales AS (
  SELECT
    business_date,
    COALESCE(SUM(revenue) FILTER (WHERE report_type='FOOD'), 0) AS food_revenue,
    COALESCE(SUM(revenue) FILTER (WHERE report_type='BEVERAGE'), 0) AS beverage_revenue
  FROM vw_daily_sales_summary
  GROUP BY business_date
), payments AS (
  SELECT
    business_date,
    COALESCE(SUM(amount), 0) AS cashier_inflow,
    COALESCE(SUM(amount) FILTER (WHERE payment_method_code='CASH'), 0) AS cash_inflow,
    COALESCE(SUM(amount) FILTER (WHERE payment_method_code='QRIS'), 0) AS qris_inflow,
    COALESCE(SUM(amount) FILTER (WHERE payment_method_code='TRANSFER'), 0) AS transfer_inflow
  FROM vw_daily_payment_summary
  GROUP BY business_date
), expenses AS (
  SELECT business_date, COALESCE(SUM(amount), 0) AS cashier_outflow
  FROM vw_daily_cashier_expenses
  GROUP BY business_date
), housebank AS (
  SELECT
    business_date,
    COALESCE(SUM(amount) FILTER (WHERE destination_fund_account_id=(SELECT id FROM fund_accounts WHERE code='HOUSEBANK') AND transaction_type='EXTERNAL_FUNDING'), 0) AS housebank_external_funding,
    COALESCE(SUM(amount) FILTER (WHERE source_fund_account_id=(SELECT id FROM fund_accounts WHERE code='HOUSEBANK') AND transaction_type='EXPENSE'), 0) AS housebank_expense,
    COALESCE(SUM(amount) FILTER (WHERE source_fund_account_id=(SELECT id FROM fund_accounts WHERE code='HOUSEBANK') AND transaction_type='INTERNAL_TRANSFER'), 0) AS housebank_transfer_to_cashier
  FROM fund_transactions
  WHERE status='POSTED'
  GROUP BY business_date
), days AS (
  SELECT business_date FROM vw_daily_completeness
  UNION SELECT business_date FROM fund_transactions
)
SELECT
  d.business_date,
  COALESCE(s.food_revenue,0) AS food_revenue,
  COALESCE(s.beverage_revenue,0) AS beverage_revenue,
  COALESCE(s.food_revenue,0) + COALESCE(s.beverage_revenue,0) AS product_sales_total,
  COALESCE(p.cashier_inflow,0) AS cashier_inflow,
  COALESCE(p.cash_inflow,0) AS cash_inflow,
  COALESCE(p.qris_inflow,0) AS qris_inflow,
  COALESCE(p.transfer_inflow,0) AS transfer_inflow,
  COALESCE(e.cashier_outflow,0) AS cashier_outflow,
  COALESCE(h.housebank_external_funding,0) AS housebank_external_funding,
  COALESCE(h.housebank_expense,0) AS housebank_expense,
  COALESCE(h.housebank_transfer_to_cashier,0) AS housebank_transfer_to_cashier,
  c.completeness_status,
  c.cashier_complete,
  c.kitchen_complete,
  c.beverage_complete
FROM days d
LEFT JOIN sales s ON s.business_date=d.business_date
LEFT JOIN payments p ON p.business_date=d.business_date
LEFT JOIN expenses e ON e.business_date=d.business_date
LEFT JOIN housebank h ON h.business_date=d.business_date
LEFT JOIN vw_daily_completeness c ON c.business_date=d.business_date;

COMMIT;
