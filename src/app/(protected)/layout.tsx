import Link from "next/link";
import { signOut } from "@/auth";
import { requireActor } from "@/lib/auth/authorization";
import { Permission } from "@/lib/auth/permissions";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  const can = (permission: string) => actor.permissions.includes(permission);

  const items = [
    ["/dashboard", "Dashboard", can(Permission.DASHBOARD_EXECUTIVE_VIEW) || can(Permission.DASHBOARD_OPERATIONAL_VIEW)],
    ["/sales", "Sales", can(Permission.SALES_VIEW)],
    ["/cashier", "Cashier", can(Permission.CASHIER_VIEW)],
    ["/finance", "Finance", can(Permission.FINANCE_VIEW)],
    ["/purchase", "Purchase", can(Permission.PURCHASE_VIEW)],
    ["/inventory", "Inventory", can(Permission.INVENTORY_VIEW)],
    ["/reports", "Reports", can(Permission.REPORT_VIEW)],
    ["/data-issues", "Data Issues", can(Permission.DATA_ISSUE_VIEW)],
    ["/audit", "Audit Trail", can(Permission.AUDIT_VIEW) || can(Permission.AUDIT_VIEW_LIMITED)],
    ["/settings", "Settings", can(Permission.SETTINGS_MANAGE)],
  ] as const;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">dopamin</div>
        <div className="sidebar-subtitle">coffee & workspace</div>
        <nav>
          {items.filter((item) => item[2]).map(([href, label]) => (
            <Link className="nav-link" href={href} key={href}>{label}</Link>
          ))}
        </nav>
        <div className="sidebar-user">
          <strong>{actor.role}</strong>
          <span>{actor.fullName}</span>
          <form action={async () => { "use server"; await signOut({ redirectTo: "/login" }); }}>
            <button className="ghost-button" type="submit">Keluar</button>
          </form>
        </div>
      </aside>
      <main className="app-content">{children}</main>
    </div>
  );
}
