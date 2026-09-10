import { requirePermission } from "@/lib/auth/authorization";
import { Permission } from "@/lib/auth/permissions";
import { getDailyReportSettings } from "@/modules/reporting/report-settings.service";
import { listSourceAliases } from "@/modules/settings/source-alias.service";
import { DailyReportSettingsForm } from "@/components/settings/daily-report-settings-form";
import { SourceAliasManager } from "@/components/settings/source-alias-manager";
import { listAccessRequests } from "@/modules/settings/access-request.service";
import { AccessRequestManager } from "@/components/settings/access-request-manager";

export default async function SettingsPage() {
  const actor = await requirePermission(Permission.SETTINGS_MANAGE);
  const access = ['OWNER', 'DIRECTOR'].includes(actor.role) ? await listAccessRequests(actor) : null;
  const d = await getDailyReportSettings(actor);
  const aliasData = actor.permissions.includes(Permission.USER_MANAGE) ? await listSourceAliases(actor) : null;
  return <main className="page-shell">
    <header className="page-header"><div><h1>Settings</h1><p className="muted">Business reporting timezone: Asia/Jakarta. Material settings changes are audited.</p></div></header>
    {access && <AccessRequestManager requests={access.requests.map(r => ({ id: r.id, email: r.email, fullName: r.fullName, requestedAt: r.requestedAt.toISOString() }))} roles={access.roles} />}
    <DailyReportSettingsForm initial={{ enabled: d.settings?.enabled ?? false, sendTime: d.settings?.sendTime ?? "22:00", recipients: d.recipients.map((r) => ({ email: r.email, recipientName: r.recipientName, isEnabled: r.isEnabled })) }} />
    {aliasData && <SourceAliasManager initialAliases={aliasData.aliases} users={aliasData.users} />}
    <section className="panel"><h2>Scheduler integration</h2><p>Google Apps Script should run <code>dailyReportHeartbeat</code> approximately every 15 minutes. The backend decides whether the configured send time is due and prevents duplicate report runs.</p><p className="muted">The default form value 22:00 shown before initial configuration is only a UI placeholder and is not persisted until Save is clicked.</p></section>
  </main>;
}
