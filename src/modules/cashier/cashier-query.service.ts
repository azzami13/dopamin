import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import type { ActorContext } from "@/lib/auth/authorization";
import { assertPermission } from "@/lib/auth/authorization";
import { Permission } from "@/lib/auth/permissions";
import { appError } from "@/lib/http/api";

function rows<T = Record<string, unknown>>(value: unknown): T[] { return value as T[]; }
function ownOnly(actor: ActorContext) { return actor.role === "CASHIER"; }

export async function listCashierReports(actor: ActorContext, from: string, to: string) {
  assertPermission(actor, Permission.CASHIER_VIEW);
  const result = await db.execute(sql`
    select cr.id, cr.business_date, cr.cashier_name_raw, cr.cashier_user_id, cr.shift_code,
      cr.opening_closing_status, cr.report_status,
      coalesce((select sum(pl.amount) from payment_lines pl where pl.cashier_report_id=cr.id),0) as payment_total,
      coalesce((select sum(cel.amount) from cashier_expense_lines cel where cel.cashier_report_id=cr.id),0) as expense_total,
      coalesce((select sum(cc.denomination_amount*cc.quantity) from cash_counts cc where cc.cashier_report_id=cr.id),0) as actual_counted_cash
    from cashier_reports cr
    where cr.business_date between ${from}::date and ${to}::date
      and cr.report_status <> 'SUPERSEDED'
      and (${!ownOnly(actor)} or cr.cashier_user_id=${actor.userId}::uuid)
    order by cr.business_date desc, cr.id desc limit 250
  `);
  return rows(result);
}

export async function getCashierReportDetail(actor: ActorContext, id: string) {
  assertPermission(actor, Permission.CASHIER_VIEW);
  const result = await db.execute(sql`
    select cr.*, rs.source_record_key, rs.source_revision, rs.submitted_at
    from cashier_reports cr join raw_submissions rs on rs.id=cr.source_submission_id
    where cr.id=${id}::uuid limit 1
  `);
  const report = rows(result)[0];
  if (!report) throw appError("Cashier report not found", 404, "CASHIER_REPORT_NOT_FOUND");
  if (ownOnly(actor) && String(report.cashier_user_id ?? "") !== actor.userId) throw appError("Cashier report is outside own-source scope", 403, "FORBIDDEN");
  const payments = await db.execute(sql`
    select pm.code, pm.name, pl.amount, pl.source_field from payment_lines pl
    join payment_methods pm on pm.id=pl.payment_method_id where pl.cashier_report_id=${id}::uuid order by pm.name
  `);
  const expenses = await db.execute(sql`
    select coalesce(ec.code,'UNMAPPED') as code, coalesce(ec.name,'Belum dipetakan') as name,
      cel.amount, cel.staff_name_raw, cel.description, cel.source_field
    from cashier_expense_lines cel left join expense_categories ec on ec.id=cel.expense_category_id
    where cel.cashier_report_id=${id}::uuid order by cel.id
  `);
  const counts = await db.execute(sql`
    select denomination_amount, quantity, denomination_amount*quantity as subtotal, source_field
    from cash_counts where cashier_report_id=${id}::uuid order by denomination_amount desc
  `);
  return { report, payments: rows(payments), expenses: rows(expenses), counts: rows(counts) };
}
