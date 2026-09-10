import { StatusBadge } from "@/components/ui/status-badge";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/authorization";
import { Permission } from "@/lib/auth/permissions";
import { resolveReportDateRange } from "@/lib/time/default-business-date";
import { getSalesOverview } from "@/modules/sales/sales-query.service";

const idr = (value: unknown) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value ?? 0));

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const actor = await requirePermission(Permission.SALES_VIEW);
  const { from, to } = await resolveReportDateRange('sales', actor, await searchParams);
  const data = await getSalesOverview(actor, from, to);
  const summary = data.summary as Array<Record<string, unknown>>;
  return <main className="page-shell">
    <header className="page-header"><div><h1>Sales</h1><p className="muted">Food/Beverage quantities and revenue use Business Date + effective menu price snapshot.</p></div>
      <form className="date-filter"><label>From<input type="date" name="from" defaultValue={from}/></label><label>To<input type="date" name="to" defaultValue={to}/></label><button className="primary-button">Terapkan</button></form>
    </header>
    <section className="kpi-grid">{summary.map((r) => <article className="kpi-card" key={String(r.report_type)}><div className="kpi-label">{String(r.report_type)}</div><div className="kpi-value">{idr(r.revenue)}</div><div className="muted">Qty {String(r.quantity ?? 0)}</div></article>)}{!summary.length && <article className="kpi-card"><div className="muted">Belum ada sales VALID pada rentang ini.</div></article>}</section>
    <section className="dashboard-grid">
      <article className="panel"><h2>Top Menu</h2><ResponsiveTable className="table-wrap"><table className="data-table"><thead><tr><th>Menu</th><th>Category</th><th>Qty</th><th className="money-cell">Revenue</th></tr></thead><tbody>{(data.topItems as Array<Record<string, unknown>>).map((r) => <tr key={String(r.code)}><td>{String(r.name)}<br/><small>{String(r.code)}</small></td><td>{String(r.category)}</td><td>{String(r.quantity)}</td><td className="money-cell">{idr(r.revenue)}</td></tr>)}</tbody></table></ResponsiveTable></article>
      <article className="panel"><h2>Scope</h2><p className="muted">Role: {actor.role}. Cashier/Kitchen views are restricted to role-relevant own-source reports when identity aliases are configured.</p></article>
    </section>
    <section className="panel"><h2>Source Reports</h2><ResponsiveTable className="table-wrap"><table className="data-table"><thead><tr><th>Date</th><th>Type</th><th>Inputter</th><th>Status</th><th>Qty</th><th className="money-cell">Revenue</th><th><span className="sr-only">Tindakan</span></th></tr></thead><tbody>{(data.reports as Array<Record<string, unknown>>).map((r) => <tr key={String(r.id)}><td>{String(r.business_date)}</td><td>{String(r.report_type)}</td><td>{String(r.inputter_name_raw ?? "-")}</td><td><StatusBadge value={String(r.report_status)} /></td><td>{String(r.quantity)}</td><td className="money-cell">{idr(r.revenue)}</td><td><Link href={`/sales/${r.id}`}>Detail</Link></td></tr>)}</tbody></table></ResponsiveTable></section>
  </main>;
}
