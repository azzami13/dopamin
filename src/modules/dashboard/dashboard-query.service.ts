import Decimal from "decimal.js";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import type { ActorContext } from "@/lib/auth/authorization";
import { Permission } from "@/lib/auth/permissions";
import { appError } from "@/lib/http/api";

export type ManagementMetrics = {
  businessDate: string;
  foodRevenue: string;
  beverageRevenue: string;
  productSalesTotal: string;
  cashierInflow: string;
  cashInflow: string;
  qrisInflow: string;
  transferInflow: string;
  cashierOutflow: string;
  housebankExternalFunding: string;
  housebankExpense: string;
  housebankTransferToCashier: string;
  completenessStatus: string;
  cashierComplete: boolean;
  kitchenComplete: boolean;
  beverageComplete: boolean;
};

const zeroMetrics = (date: string): ManagementMetrics => ({
  businessDate: date, foodRevenue: "0.00", beverageRevenue: "0.00", productSalesTotal: "0.00", cashierInflow: "0.00", cashInflow: "0.00", qrisInflow: "0.00", transferInflow: "0.00", cashierOutflow: "0.00", housebankExternalFunding: "0.00", housebankExpense: "0.00", housebankTransferToCashier: "0.00", completenessStatus: "INCOMPLETE", cashierComplete: false, kitchenComplete: false, beverageComplete: false,
});

function mapMetrics(row: Record<string, unknown> | undefined, date: string): ManagementMetrics {
  if (!row) return zeroMetrics(date);
  const money = (key: string) => new Decimal(String(row[key] ?? "0")).toFixed(2);
  return {
    businessDate: String(row.business_date ?? date),
    foodRevenue: money("food_revenue"), beverageRevenue: money("beverage_revenue"), productSalesTotal: money("product_sales_total"), cashierInflow: money("cashier_inflow"), cashInflow: money("cash_inflow"), qrisInflow: money("qris_inflow"), transferInflow: money("transfer_inflow"), cashierOutflow: money("cashier_outflow"), housebankExternalFunding: money("housebank_external_funding"), housebankExpense: money("housebank_expense"), housebankTransferToCashier: money("housebank_transfer_to_cashier"),
    completenessStatus: String(row.completeness_status ?? "INCOMPLETE"), cashierComplete: Boolean(row.cashier_complete), kitchenComplete: Boolean(row.kitchen_complete), beverageComplete: Boolean(row.beverage_complete),
  };
}

export async function managementMetricsForDate(date: string): Promise<ManagementMetrics> {
  const rows = await db.execute(sql`select * from vw_daily_management_report where business_date = ${date}::date limit 1`);
  return mapMetrics((rows as unknown as Record<string, unknown>[])[0], date);
}

export async function getDashboardSnapshot(actor: ActorContext, businessDate: string) {
  if (!actor.permissions.includes(Permission.DASHBOARD_EXECUTIVE_VIEW) && !actor.permissions.includes(Permission.DASHBOARD_OPERATIONAL_VIEW)) {
    throw appError("Dashboard permission is required", 403, "FORBIDDEN");
  }
  const metrics = await managementMetricsForDate(businessDate);
  const trendRows = await db.execute(sql`
    select business_date, product_sales_total
    from vw_daily_management_report
    where business_date between (${businessDate}::date - interval '6 days')::date and ${businessDate}::date
    order by business_date
  `);
  const housebankRows = await db.execute(sql`
    select running_balance from vw_housebank_ledger
    where business_date <= ${businessDate}::date
    order by business_date desc, created_at desc, id desc limit 1
  `);
  const inventoryRows = await db.execute(sql`
    select
      count(*) filter (where sol.reference_qty is not null and sol.actual_qty <> sol.reference_qty) as variance_count,
      count(distinct sos.category) filter (where sos.status in ('SUBMITTED','REVIEWED')) as completed_categories
    from stock_opname_sessions sos
    left join stock_opname_lines sol on sol.session_id=sos.id
    where sos.business_date=${businessDate}::date
  `);
  const prRows = await db.execute(sql`
    select count(*) as pending_count from purchase_requests
    where status in ('SUBMITTED','REVISION_REQUESTED','APPROVED','FUNDED_READY_TO_SPEND','PURCHASED','RECEIPT_RECORDED')
  `);
  const housebankBalance = new Decimal(String((housebankRows as unknown as Record<string, unknown>[])[0]?.running_balance ?? "0")).toFixed(2);
  const inv = (inventoryRows as unknown as Record<string, unknown>[])[0] ?? {};
  const pr = (prRows as unknown as Record<string, unknown>[])[0] ?? {};
  return {
    metrics,
    housebankBalance,
    inventoryVarianceCount: Number(inv.variance_count ?? 0),
    stockCompletedCategories: Number(inv.completed_categories ?? 0),
    pendingPurchaseRequests: Number(pr.pending_count ?? 0),
    trend: (trendRows as unknown as Record<string, unknown>[]).map((r) => ({ businessDate: String(r.business_date), total: new Decimal(String(r.product_sales_total ?? "0")).toFixed(2) })),
  };
}
