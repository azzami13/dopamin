import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs, dailyReportRecipients, dailyReportSettings } from "@/db/schema";
import type { ActorContext } from "@/lib/auth/authorization";
import { assertPermission } from "@/lib/auth/authorization";
import { Permission } from "@/lib/auth/permissions";
import { appError } from "@/lib/http/api";

export async function getDailyReportSettings(actor: ActorContext) {
  assertPermission(actor, Permission.SETTINGS_MANAGE);
  const [settings] = await db.select().from(dailyReportSettings).orderBy(desc(dailyReportSettings.updatedAt)).limit(1);
  if (!settings) return { configured: false, settings: null, recipients: [] };
  const recipients = await db.select().from(dailyReportRecipients).where(eq(dailyReportRecipients.settingsId, settings.id));
  return { configured: true, settings, recipients };
}

export async function saveDailyReportSettings(actor: ActorContext, input: { enabled: boolean; sendTime: string; timezone: string; recipients: { email: string; recipientName?: string; isEnabled?: boolean }[] }) {
  assertPermission(actor, Permission.SETTINGS_MANAGE);
  if (input.timezone !== "Asia/Jakarta") throw appError("MVP business/report timezone must remain Asia/Jakarta", 422, "TIMEZONE_NOT_SUPPORTED");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.sendTime)) throw appError("sendTime must use HH:MM", 422, "INVALID_SEND_TIME");
  if (input.enabled && !input.recipients.some((r) => r.isEnabled !== false)) throw appError("At least one enabled recipient is required when daily reporting is enabled", 422, "REPORT_RECIPIENT_REQUIRED");
  const before = await getDailyReportSettings(actor);
  return db.transaction(async (tx) => {
    let settingsId: string;
    if (before.settings) {
      settingsId = before.settings.id;
      await tx.update(dailyReportSettings).set({ enabled: input.enabled, sendTime: input.sendTime, timezone: input.timezone, incompleteBehavior: "SEND_INCOMPLETE", updatedBy: actor.userId, updatedAt: new Date() }).where(eq(dailyReportSettings.id, settingsId));
      await tx.delete(dailyReportRecipients).where(eq(dailyReportRecipients.settingsId, settingsId));
    } else {
      const [created] = await tx.insert(dailyReportSettings).values({ enabled: input.enabled, sendTime: input.sendTime, timezone: input.timezone, incompleteBehavior: "SEND_INCOMPLETE", updatedBy: actor.userId }).returning({ id: dailyReportSettings.id });
      settingsId = created.id;
    }
    if (input.recipients.length) await tx.insert(dailyReportRecipients).values(input.recipients.map((r) => ({ settingsId, email: r.email.toLowerCase(), recipientName: r.recipientName?.trim() || null, isEnabled: r.isEnabled !== false })));
    await tx.insert(auditLogs).values({ actorUserId: actor.userId, actorRole: actor.role, action: "SETTINGS_CHANGE", module: "SETTINGS", entityType: "daily_report_settings", entityId: settingsId, beforeData: before.configured ? { settings: before.settings, recipients: before.recipients.map((r) => ({ email: r.email, isEnabled: r.isEnabled })) } : undefined, afterData: { enabled: input.enabled, sendTime: input.sendTime, timezone: input.timezone, recipients: input.recipients.map((r) => ({ email: r.email.toLowerCase(), isEnabled: r.isEnabled !== false })) }, source: "WEB" });
    return { settingsId, enabled: input.enabled, sendTime: input.sendTime, recipients: input.recipients.length };
  });
}
