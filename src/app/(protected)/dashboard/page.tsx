import Decimal from "decimal.js";
import { requireActor } from "@/lib/auth/authorization";
import { resolveDashboardDate } from "@/lib/time/default-business-date";
import { getDashboardSnapshot } from "@/modules/dashboard/dashboard-query.service";

function idr(value: string) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value));
}

function Badge({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return <span className={ok ? "status-badge status-ok" : "status-badge status-warning"}>{children}</span>;
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const actor = await requireActor();
  const search = await searchParams;
  const businessDate = await resolveDashboardDate(search.date);
  const data = await getDashboardSnapshot(actor, businessDate);
  const m = data.metrics;
  const difference = new Decimal(m.productSalesTotal).minus(m.cashierInflow).toFixed(2);
  const maxTrend = Math.max(1, ...data.trend.map((x) => Number(x.total)));

  const executive = actor.role === "OWNER" || actor.role === "DIRECTOR";
  const manager = actor.role === "MANAGER";
  const cashier = actor.role === "CASHIER";
  const cards = executive
    ? [["Total Sales", idr(m.productSalesTotal), "Food + Beverage"], ["Cashier Inflow", idr(m.cashierInflow), "Received payments"], ["Cashier Expense", idr(m.cashierOutflow), "Operational outflow"], ["Housebank", idr(data.housebankBalance), "Derived current balance"]]
    : manager
      ? [["Cashier Report", m.cashierComplete ? "COMPLETE" : "CHECK", "Required source"], ["Kitchen Report", m.kitchenComplete ? "COMPLETE" : "CHECK", "Required source"], ["Beverage Report", m.beverageComplete ? "COMPLETE" : "CHECK", "Required source"], ["Purchase Requests", String(data.pendingPurchaseRequests), "Pending operational flow"]]
      : cashier
        ? [["Received", idr(m.cashierInflow), "All payment methods"], ["Cash", idr(m.cashInflow), "Physical cash sales"], ["QRIS", idr(m.qrisInflow), "QRIS received"], ["Expenses", idr(m.cashierOutflow), "Cashier-paid"]]
        : [["Food Report", m.kitchenComplete ? "SUBMITTED" : "NOT SUBMITTED", "Kitchen sales source"], ["Business Date", businessDate, "Asia/Jakarta"], ["Data Status", m.completenessStatus, "Daily completeness"], ["Workspace", "KITCHEN", "No finance account access"]];

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <div className="brand-kicker">dopamin</div>
          <h1>{executive ? "Executive Dashboard" : manager ? "Manager Operations" : cashier ? "Cashier & Beverage" : "Kitchen Workspace"}</h1>
          <p className="muted">Business Date based reporting • Asia/Jakarta</p>
        </div>
        <form className="date-filter" method="get">
          <label htmlFor="date">Business Date</label>
          <input key={businessDate} id="date" name="date" type="date" defaultValue={businessDate} />
          <button className="primary-button" type="submit">Terapkan</button>
        </form>
      </header>

      <section className="kpi-grid">
        {cards.map(([label, value, meta]) => <article className="kpi-card" key={label}><div className="kpi-label">{label}</div><div className="kpi-value">{value}</div><div className="muted kpi-meta">{meta}</div></article>)}
      </section>

      {(executive || manager) && <section className="dashboard-grid">
        <article className="panel">
          <div className="panel-title-row"><h2>Revenue Trend</h2><span className="muted">7 hari</span></div>
          <div className="trend-bars">
            {data.trend.length ? data.trend.map((point) => <div className="trend-column" key={point.businessDate} title={`${point.businessDate}: ${idr(point.total)}`}><div className="trend-bar" style={{ height: `${Math.max(4, Math.round((Number(point.total) / maxTrend) * 150))}px` }} /><span>{point.businessDate.slice(8)}</span></div>) : <p className="muted">Belum ada data trend.</p>}
          </div>
        </article>
        <article className="panel">
          <h2>Data Completeness</h2>
          <div className="status-list"><div>Cashier <Badge ok={m.cashierComplete}>{m.cashierComplete ? "COMPLETE" : "MISSING / REVIEW"}</Badge></div><div>Kitchen <Badge ok={m.kitchenComplete}>{m.kitchenComplete ? "COMPLETE" : "MISSING / REVIEW"}</Badge></div><div>Beverage <Badge ok={m.beverageComplete}>{m.beverageComplete ? "COMPLETE" : "MISSING / REVIEW"}</Badge></div></div>
        </article>
      </section>}

      {manager && <section className="kpi-grid secondary-grid"><article className="kpi-card"><div className="kpi-label">Sales ↔ Payment Difference</div><div className="kpi-value">{idr(difference)}</div><div className="muted kpi-meta">Reconciliation signal; not manually editable</div></article><article className="kpi-card"><div className="kpi-label">Stock Variances</div><div className="kpi-value">{data.inventoryVarianceCount}</div><div className="muted kpi-meta">Exceptions requiring review</div></article><article className="kpi-card"><div className="kpi-label">Stock Categories Complete</div><div className="kpi-value">{data.stockCompletedCategories} / 3</div><div className="muted kpi-meta">Kitchen / Bar / Other</div></article></section>}

      {cashier && <section className="panel"><h2>Today Submission</h2><div className="status-list"><div>Cashier Form <Badge ok={m.cashierComplete}>{m.cashierComplete ? "SUBMITTED" : "CHECK"}</Badge></div><div>Beverage Form <Badge ok={m.beverageComplete}>{m.beverageComplete ? "SUBMITTED" : "CHECK"}</Badge></div></div></section>}
      {actor.role === "KITCHEN" && <section className="panel"><h2>Kitchen Submission</h2><div className="status-list"><div>Food Report <Badge ok={m.kitchenComplete}>{m.kitchenComplete ? "SUBMITTED" : "NOT SUBMITTED"}</Badge></div></div><p className="muted">Stock Opname Kitchen tersedia melalui modul Inventory. Informasi Housebank/finance tidak ditampilkan untuk role Kitchen.</p></section>}
    </main>
  );
}
