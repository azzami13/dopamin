import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import type { ActorContext } from "@/lib/auth/authorization";
import { assertPermission } from "@/lib/auth/authorization";
import { Permission } from "@/lib/auth/permissions";
import { appError } from "@/lib/http/api";

function rows<T = Record<string, unknown>>(value: unknown): T[] { return value as T[]; }

function scope(actor: ActorContext) {
  if (actor.role === "KITCHEN") return { types: ["FOOD"], ownOnly: true };
  if (actor.role === "CASHIER") return { types: ["BEVERAGE"], ownOnly: true };
  return { types: ["FOOD", "BEVERAGE"], ownOnly: false };
}

export async function getSalesOverview(actor: ActorContext, from: string, to: string) {
  assertPermission(actor, Permission.SALES_VIEW);
  const s = scope(actor);
  const summary = await db.execute(sql`
    select sr.report_type,
      coalesce(sum(sri.quantity),0) as quantity,
      coalesce(sum(sri.quantity * sri.unit_price_snapshot),0) as revenue
    from sales_reports sr
    join sales_report_items sri on sri.sales_report_id=sr.id
    where sr.business_date between ${from}::date and ${to}::date
      and sr.report_status='VALID'
      and sr.report_type in (${sql.join(s.types.map((type) => sql`${type}`), sql`, `)})
      and (${!s.ownOnly} or sr.inputter_user_id=${actor.userId}::uuid)
    group by sr.report_type order by sr.report_type
  `);
  const topItems = await db.execute(sql`
    select mi.code, mi.name, mi.category,
      sum(sri.quantity) as quantity,
      sum(sri.quantity * sri.unit_price_snapshot) as revenue
    from sales_reports sr
    join sales_report_items sri on sri.sales_report_id=sr.id
    join menu_items mi on mi.id=sri.menu_item_id
    where sr.business_date between ${from}::date and ${to}::date
      and sr.report_status='VALID'
      and sr.report_type in (${sql.join(s.types.map((type) => sql`${type}`), sql`, `)})
      and (${!s.ownOnly} or sr.inputter_user_id=${actor.userId}::uuid)
    group by mi.code, mi.name, mi.category
    order by revenue desc, quantity desc limit 20
  `);
  const reportRows = await db.execute(sql`
    select sr.id, sr.business_date, sr.report_type, sr.inputter_name_raw, sr.report_status,
      coalesce(sum(sri.quantity),0) as quantity,
      coalesce(sum(sri.quantity*sri.unit_price_snapshot),0) as revenue
    from sales_reports sr
    left join sales_report_items sri on sri.sales_report_id=sr.id
    where sr.business_date between ${from}::date and ${to}::date
      and sr.report_status <> 'SUPERSEDED'
      and sr.report_type in (${sql.join(s.types.map((type) => sql`${type}`), sql`, `)})
      and (${!s.ownOnly} or sr.inputter_user_id=${actor.userId}::uuid)
    group by sr.id
    order by sr.business_date desc, sr.report_type, sr.id desc limit 200
  `);
  return { summary: rows(summary), topItems: rows(topItems), reports: rows(reportRows) };
}

export async function getSalesReportDetail(actor: ActorContext, id: string) {
  assertPermission(actor, Permission.SALES_VIEW);
  const s = scope(actor);
  const reportRows = await db.execute(sql`
    select sr.id, sr.business_date, sr.report_type, sr.inputter_name_raw, sr.inputter_user_id,
      sr.report_status, sr.source_submission_id, rs.source_record_key, rs.source_revision, rs.submitted_at
    from sales_reports sr join raw_submissions rs on rs.id=sr.source_submission_id
    where sr.id=${id}::uuid limit 1
  `);
  const report = rows(reportRows)[0];
  if (!report) throw appError("Sales report not found", 404, "SALES_REPORT_NOT_FOUND");
  if (!s.types.includes(String(report.report_type))) throw appError("Sales report is outside role scope", 403, "FORBIDDEN");
  if (s.ownOnly && String(report.inputter_user_id ?? "") !== actor.userId) throw appError("Sales report is outside own-source scope", 403, "FORBIDDEN");
  const itemRows = await db.execute(sql`
    select mi.code, mi.name, mi.category, sri.quantity, sri.unit_price_snapshot,
      sri.quantity*sri.unit_price_snapshot as revenue, sri.source_field
    from sales_report_items sri join menu_items mi on mi.id=sri.menu_item_id
    where sri.sales_report_id=${id}::uuid order by mi.name
  `);
  return { report, items: rows(itemRows) };
}
