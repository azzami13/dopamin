import Decimal from "decimal.js";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { cashierReports, dailyClosings, salesReports } from "@/db/schema";

type Connection = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

type SourceState = "MISSING" | "VALID" | "NEEDS_REVIEW";

async function cashierState(date: string, connection: Connection): Promise<SourceState> {
  const allRows = await connection.select({ status: cashierReports.reportStatus }).from(cashierReports).where(eq(cashierReports.businessDate, date));
  const rows = allRows.filter((r) => r.status !== "SUPERSEDED");
  if (rows.length && rows.every((r) => r.status === "VALID")) return "VALID";
  if (rows.length) return "NEEDS_REVIEW";
  return "MISSING";
}
async function salesState(date: string, type: "FOOD" | "BEVERAGE", connection: Connection): Promise<SourceState> {
  const allRows = await connection.select({ status: salesReports.reportStatus }).from(salesReports).where(and(eq(salesReports.businessDate, date), eq(salesReports.reportType, type)));
  const rows = allRows.filter((r) => r.status !== "SUPERSEDED");
  if (rows.length && rows.every((r) => r.status === "VALID")) return "VALID";
  if (rows.length) return "NEEDS_REVIEW";
  return "MISSING";
}

export async function evaluateDailyClosing(businessDate: string, closedBy?: string, connection: Connection = db) {
  const [cashier, kitchen, beverage] = await Promise.all([cashierState(businessDate, connection), salesState(businessDate, "FOOD", connection), salesState(businessDate, "BEVERAGE", connection)]);
  const totals = await connection.execute(sql`
    with p as (
      select coalesce(sum(pl.amount),0) as payment_total
      from cashier_reports cr join payment_lines pl on pl.cashier_report_id=cr.id
      where cr.business_date=${businessDate}::date and cr.report_status='VALID'
    ), s as (
      select coalesce(sum(sri.quantity*sri.unit_price_snapshot),0) as sales_total
      from sales_reports sr join sales_report_items sri on sri.sales_report_id=sr.id
      where sr.business_date=${businessDate}::date and sr.report_status='VALID'
    ) select p.payment_total, s.sales_total from p cross join s
  `);
  const totalRow = (totals as unknown as Record<string, unknown>[])[0] ?? {};
  const paymentTotal = new Decimal(String(totalRow.payment_total ?? "0")).toFixed(2);
  const salesTotal = new Decimal(String(totalRow.sales_total ?? "0")).toFixed(2);
  const difference = new Decimal(salesTotal).minus(paymentTotal).toFixed(2);
  const complete = cashier === "VALID" && kitchen === "VALID" && beverage === "VALID";
  const status = complete ? "RECONCILED" : "INCOMPLETE";
  const values = { closedBy: closedBy ?? null, businessDate, status, cashierComplete: cashier === "VALID", kitchenComplete: kitchen === "VALID", beverageComplete: beverage === "VALID", paymentTotalSnapshot: paymentTotal, salesTotalSnapshot: salesTotal, salesPaymentDifference: difference, cashVarianceSnapshot: null };
  const [closing] = await connection.insert(dailyClosings).values(values).onConflictDoUpdate({ target: dailyClosings.businessDate, set: values }).returning();
  return { closing, sources: { cashier, kitchen, beverage }, completenessStatus: complete ? "COMPLETE" as const : "INCOMPLETE" as const, missingSources: Object.entries({ Cashier: cashier, Kitchen: kitchen, Beverage: beverage }).filter(([, state]) => state !== "VALID").map(([source, state]) => ({ source, state })) };
}
