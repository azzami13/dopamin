import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import type { ActorContext } from '@/lib/auth/identity-context';
import { jakartaDate } from './business-date';

function explicitDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export async function resolveDashboardDate(date?: string, now = new Date()): Promise<string> {
  if (explicitDate(date)) return date;
  const today = jakartaDate(now);
  const [row] = await db.execute(sql`
    select coalesce(max(business_date) filter (where business_date = ${today}::date), max(business_date))::text as resolved
    from (
      select business_date from cashier_reports
      union all select business_date from sales_reports
      union all select business_date from daily_closings
    ) operational_dates
  `);
  return typeof row?.resolved === 'string' ? row.resolved : today;
}

export async function resolveReportDateRange(source: 'sales' | 'cashier', actor: ActorContext,
  query: { from?: string; to?: string }, now = new Date()): Promise<{ from: string; to: string }> {
  let to = explicitDate(query.to) ? query.to : undefined;
  if (!to) {
    // Match the existing source-report list's category, identity and revision scope.
    const rows = source === 'sales'
      ? await db.execute(sql`select max(business_date)::text as resolved from sales_reports
          where report_status <> 'SUPERSEDED'
          and (${actor.role !== 'KITCHEN'} or report_type = 'FOOD')
          and (${actor.role !== 'CASHIER'} or report_type = 'BEVERAGE')
          and (${!['KITCHEN', 'CASHIER'].includes(actor.role)} or inputter_user_id = ${actor.userId}::uuid)`)
      : await db.execute(sql`select max(business_date)::text as resolved from cashier_reports
          where report_status <> 'SUPERSEDED'
          and (${actor.role !== 'CASHIER'} or cashier_user_id = ${actor.userId}::uuid)`);
    to = typeof rows[0]?.resolved === 'string' ? rows[0].resolved : jakartaDate(now);
  }
  const start = new Date(`${to}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 29);
  return { from: explicitDate(query.from) ? query.from : start.toISOString().slice(0, 10), to };
}
