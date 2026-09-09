BEGIN;

CREATE OR REPLACE VIEW vw_daily_completeness AS
WITH days AS (
  SELECT business_date FROM cashier_reports WHERE report_status <> 'SUPERSEDED'
  UNION
  SELECT business_date FROM sales_reports WHERE report_status <> 'SUPERSEDED'
), cashier_state AS (
  SELECT business_date,
    count(*) > 0 AND bool_and(report_status = 'VALID') AS complete
  FROM cashier_reports
  WHERE report_status <> 'SUPERSEDED'
  GROUP BY business_date
), food_state AS (
  SELECT business_date,
    count(*) > 0 AND bool_and(report_status = 'VALID') AS complete
  FROM sales_reports
  WHERE report_status <> 'SUPERSEDED' AND report_type='FOOD'
  GROUP BY business_date
), beverage_state AS (
  SELECT business_date,
    count(*) > 0 AND bool_and(report_status = 'VALID') AS complete
  FROM sales_reports
  WHERE report_status <> 'SUPERSEDED' AND report_type='BEVERAGE'
  GROUP BY business_date
)
SELECT
  d.business_date,
  coalesce(c.complete,false) AS cashier_complete,
  coalesce(f.complete,false) AS kitchen_complete,
  coalesce(b.complete,false) AS beverage_complete,
  CASE WHEN coalesce(c.complete,false) AND coalesce(f.complete,false) AND coalesce(b.complete,false)
    THEN 'COMPLETE' ELSE 'INCOMPLETE' END AS completeness_status
FROM days d
LEFT JOIN cashier_state c ON c.business_date=d.business_date
LEFT JOIN food_state f ON f.business_date=d.business_date
LEFT JOIN beverage_state b ON b.business_date=d.business_date;

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
  COALESCE(c.completeness_status,'INCOMPLETE') AS completeness_status,
  COALESCE(c.cashier_complete,false) AS cashier_complete,
  COALESCE(c.kitchen_complete,false) AS kitchen_complete,
  COALESCE(c.beverage_complete,false) AS beverage_complete
FROM days d
LEFT JOIN sales s ON s.business_date=d.business_date
LEFT JOIN payments p ON p.business_date=d.business_date
LEFT JOIN expenses e ON e.business_date=d.business_date
LEFT JOIN housebank h ON h.business_date=d.business_date
LEFT JOIN vw_daily_completeness c ON c.business_date=d.business_date;

COMMIT;
