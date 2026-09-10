import { Navigation } from "@/components/ui/navigation";
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
      <a className="skip-link" href="#main-content">Lewati navigasi</a>
      <Navigation items={items.filter(item => item[2]).map(([href, label]) => ({ href, label }))}>

          <strong>{actor.role}</strong>
          <span>{actor.fullName}</span>
          <Link className="nav-link" href="/change-password">Ganti password</Link>
          <form action={async () => { "use server"; await signOut({ redirectTo: "/login" }); }}>
            <button className="ghost-button" type="submit">Keluar</button>
          </form>
      </Navigation>
      <div className="app-content" id="main-content" tabIndex={-1}><div className="workspace-header"><span>Operations workspace</span><span>Asia/Jakarta / Business Date</span></div>{children}</div>
    </div>
  );
}
