import Decimal from "decimal.js";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs, dailyReportDeliveries, dailyReportRecipients, dailyReportRuns, dailyReportSettings } from "@/db/schema";
import type { ActorContext } from "@/lib/auth/authorization";
import { assertPermission } from "@/lib/auth/authorization";
import { Permission } from "@/lib/auth/permissions";
import { appError } from "@/lib/http/api";
import { jakartaDate, jakartaTime, previousJakartaBusinessDate, timeAtOrAfter } from "@/lib/time/business-date";
import { managementMetricsForDate } from "@/modules/dashboard/dashboard-query.service";
import { evaluateDailyClosing } from "./closing.service";

function idr(value: unknown) {
  const d = new Decimal(String(value ?? "0"));
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(d.toFixed(2)));
}
function esc(value: unknown) { return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c)); }

async function loadSettings() {
  const [settings] = await db.select().from(dailyReportSettings).orderBy(desc(dailyReportSettings.updatedAt)).limit(1);
  if (!settings) return null;
  const recipients = await db.select().from(dailyReportRecipients).where(and(eq(dailyReportRecipients.settingsId, settings.id), eq(dailyReportRecipients.isEnabled, true))).orderBy(asc(dailyReportRecipients.email));
  return { settings, recipients };
}

async function snapshotForDate(businessDate: string, now = new Date()) {
  const closingEval = await evaluateDailyClosing(businessDate);
  const metrics = await managementMetricsForDate(businessDate);
  const balanceRows = await db.execute(sql`select running_balance from vw_housebank_ledger where business_date <= ${businessDate}::date order by business_date desc, created_at desc, id desc limit 1`);
  const housebankEndingBalance = new Decimal(String((balanceRows as unknown as Record<string, unknown>[])[0]?.running_balance ?? "0")).toFixed(2);
  const inventoryRows = await db.execute(sql`select count(*) as c from stock_opname_sessions sos join stock_opname_lines sol on sol.session_id=sos.id where sos.business_date=${businessDate}::date and sol.reference_qty is not null and sol.actual_qty <> sol.reference_qty`);
  const inventoryExceptionCount = Number((inventoryRows as unknown as Record<string, unknown>[])[0]?.c ?? 0);
  return {
    closingEval,
    snapshot: { ...metrics, housebankEndingBalance, inventoryExceptionCount, generatedForLocalDate: jakartaDate(now) } as Record<string, unknown>,
  };
}

type RenderRun = { id: string; businessDate: string; completenessStatus: string; metricsSnapshot: Record<string, unknown>; missingSources: unknown[] };
function renderEmail(run: RenderRun, recipients: string[]) {
  const s = run.metricsSnapshot;
  const incomplete = run.completenessStatus === "INCOMPLETE";
  const missingSources = Array.isArray(run.missingSources) ? run.missingSources as Array<Record<string, unknown>> : [];
  const subject = `${incomplete ? "[BELUM LENGKAP] " : ""}Laporan Harian Dopamin Cafe - ${run.businessDate}`;
  const missing = missingSources.length ? `<p><strong>Data belum lengkap:</strong> ${missingSources.map((x) => `${esc(x.source)} (${esc(x.state)})`).join(", ")}</p>` : "";
  const htmlBody = `<div style="font-family:Arial,sans-serif;color:#1D271E"><h2 style="color:#0F623E">Dopamin Cafe — Laporan Harian</h2><p>Business Date: <strong>${esc(run.businessDate)}</strong></p>${incomplete ? '<p style="padding:10px;background:#fff3cd"><strong>Status: BELUM LENGKAP</strong></p>' : '<p><strong>Status: LENGKAP</strong></p>'}${missing}<table cellpadding="7" cellspacing="0" border="1" style="border-collapse:collapse"><tr><td>Total Cashier Inflow</td><td>${idr(s.cashierInflow)}</td></tr><tr><td>Cash</td><td>${idr(s.cashInflow)}</td></tr><tr><td>QRIS</td><td>${idr(s.qrisInflow)}</td></tr><tr><td>Transfer</td><td>${idr(s.transferInflow)}</td></tr><tr><td>Food Revenue</td><td>${idr(s.foodRevenue)}</td></tr><tr><td>Beverage Revenue</td><td>${idr(s.beverageRevenue)}</td></tr><tr><td>Cashier Outflow</td><td>${idr(s.cashierOutflow)}</td></tr><tr><td>Housebank Funding</td><td>${idr(s.housebankExternalFunding)}</td></tr><tr><td>Housebank Expense</td><td>${idr(s.housebankExpense)}</td></tr><tr><td>Housebank Ending Balance</td><td>${idr(s.housebankEndingBalance)}</td></tr><tr><td>Inventory Exceptions</td><td>${esc(s.inventoryExceptionCount ?? 0)}</td></tr></table><p style="color:#68736A;font-size:12px">Snapshot run ${esc(run.id)}. Koreksi setelah email ini tidak mengubah snapshot historis.</p></div>`;
  return { action: "SEND" as const, runId: run.id, businessDate: run.businessDate, recipients, subject, htmlBody, textBody: `Dopamin Cafe ${run.businessDate} ${incomplete ? "BELUM LENGKAP" : "LENGKAP"}. Total sales ${idr(s.productSalesTotal)}. Cashier inflow ${idr(s.cashierInflow)}.` };
}

async function prepareQueuedManualDelivery() {
  const [run] = await db.select().from(dailyReportRuns).where(eq(dailyReportRuns.status, "QUEUED")).orderBy(asc(dailyReportRuns.generatedAt)).limit(1);
  if (!run) return null;
  const deliveries = await db.select().from(dailyReportDeliveries).where(and(eq(dailyReportDeliveries.reportRunId, run.id), eq(dailyReportDeliveries.deliveryStatus, "PENDING"))).orderBy(asc(dailyReportDeliveries.recipientEmail));
  if (!deliveries.length) {
    await db.update(dailyReportRuns).set({ status: "FAILED" }).where(eq(dailyReportRuns.id, run.id));
    return null;
  }
  const [claimed] = await db.update(dailyReportRuns).set({ status: "DELIVERING" }).where(and(eq(dailyReportRuns.id, run.id), eq(dailyReportRuns.status, "QUEUED"))).returning({ id: dailyReportRuns.id });
  if (!claimed) return null;
  return renderEmail({ id: run.id, businessDate: run.businessDate, completenessStatus: run.completenessStatus, metricsSnapshot: run.metricsSnapshot, missingSources: run.missingSources }, deliveries.map((d) => d.recipientEmail));
}

export async function prepareScheduledDailyReport(now = new Date()) {
  const queued = await prepareQueuedManualDelivery();
  if (queued) return queued;

  const config = await loadSettings();
  if (!config || !config.settings.enabled) return { action: "NOOP" as const, reason: "REPORT_DISABLED_OR_NOT_CONFIGURED" };
  if (!timeAtOrAfter(jakartaTime(now), config.settings.sendTime)) return { action: "NOOP" as const, reason: "NOT_DUE", dueAt: config.settings.sendTime };
  if (!config.recipients.length) return { action: "NOOP" as const, reason: "NO_RECIPIENTS" };
  const businessDate = previousJakartaBusinessDate(now);
  const [existing] = await db.select({ id: dailyReportRuns.id, status: dailyReportRuns.status }).from(dailyReportRuns).where(and(eq(dailyReportRuns.businessDate, businessDate), eq(dailyReportRuns.revisionNo, 0))).limit(1);
  if (existing) return { action: "NOOP" as const, reason: "ALREADY_RESERVED_OR_SENT", runId: existing.id, status: existing.status };

  const { closingEval, snapshot } = await snapshotForDate(businessDate, now);
  const [run] = await db.insert(dailyReportRuns).values({ dailyClosingId: closingEval.closing.id, businessDate, revisionNo: 0, triggerType: "SCHEDULED", completenessStatus: closingEval.completenessStatus, metricsSnapshot: snapshot, missingSources: closingEval.missingSources, status: "DELIVERING" }).onConflictDoNothing().returning();
  if (!run) return { action: "NOOP" as const, reason: "CONCURRENT_RESERVATION" };
  await db.insert(dailyReportDeliveries).values(config.recipients.map((r) => ({ reportRunId: run.id, recipientEmail: r.email, deliveryStatus: "PENDING" })));
  await db.insert(auditLogs).values({ action: "REPORT_GENERATED", module: "REPORTING", entityType: "daily_report_run", entityId: run.id, afterData: { businessDate, revisionNo: 0, triggerType: "SCHEDULED", completenessStatus: closingEval.completenessStatus, recipients: config.recipients.map((r) => r.email) }, source: "SYSTEM" });
  return renderEmail({ id: run.id, businessDate, completenessStatus: closingEval.completenessStatus, metricsSnapshot: snapshot, missingSources: closingEval.missingSources }, config.recipients.map((r) => r.email));
}

export async function queueManualReportRevision(actor: ActorContext, businessDate: string) {
  assertPermission(actor, Permission.REPORT_RESEND);
  const config = await loadSettings();
  if (!config || !config.recipients.length) throw appError("Configure at least one enabled daily-report recipient before generating a resend", 409, "REPORT_RECIPIENT_REQUIRED");
  const [queued] = await db.select().from(dailyReportRuns).where(and(eq(dailyReportRuns.businessDate, businessDate), eq(dailyReportRuns.status, "QUEUED"))).orderBy(desc(dailyReportRuns.revisionNo)).limit(1);
  if (queued) return { runId: queued.id, revisionNo: queued.revisionNo, status: queued.status, alreadyQueued: true };
  const [latest] = await db.select().from(dailyReportRuns).where(eq(dailyReportRuns.businessDate, businessDate)).orderBy(desc(dailyReportRuns.revisionNo)).limit(1);
  const revisionNo = latest ? latest.revisionNo + 1 : 0;
  const { closingEval, snapshot } = await snapshotForDate(businessDate);
  const [run] = await db.insert(dailyReportRuns).values({ dailyClosingId: closingEval.closing.id, parentRunId: latest?.id, triggeredBy: actor.userId, businessDate, revisionNo, triggerType: latest ? "REVISION" : "MANUAL", completenessStatus: closingEval.completenessStatus, metricsSnapshot: snapshot, missingSources: closingEval.missingSources, status: "QUEUED" }).onConflictDoNothing().returning();
  if (!run) {
    const [existing] = await db.select().from(dailyReportRuns).where(eq(dailyReportRuns.businessDate, businessDate)).orderBy(desc(dailyReportRuns.revisionNo)).limit(1);
    if (existing) return { runId: existing.id, revisionNo: existing.revisionNo, status: existing.status, alreadyQueued: existing.status === "QUEUED" };
    throw appError("Could not reserve manual report revision", 409, "REPORT_REVISION_CONFLICT");
  }
  await db.insert(dailyReportDeliveries).values(config.recipients.map((r) => ({ reportRunId: run.id, recipientEmail: r.email, deliveryStatus: "PENDING" })));
  await db.insert(auditLogs).values({ actorUserId: actor.userId, actorRole: actor.role, action: latest ? "REPORT_RESENT" : "REPORT_GENERATED", module: "REPORTING", entityType: "daily_report_run", entityId: run.id, afterData: { businessDate, revisionNo, parentRunId: latest?.id ?? null, status: "QUEUED", recipients: config.recipients.map((r) => r.email) }, source: "WEB" });
  return { runId: run.id, revisionNo, status: "QUEUED", alreadyQueued: false };
}

export async function listDailyReportRuns(actor: ActorContext) {
  assertPermission(actor, Permission.REPORT_VIEW);
  return db.select().from(dailyReportRuns).orderBy(desc(dailyReportRuns.businessDate), desc(dailyReportRuns.revisionNo));
}

export async function getDailyReportRun(actor: ActorContext, id: string) {
  assertPermission(actor, Permission.REPORT_VIEW);
  const [run] = await db.select().from(dailyReportRuns).where(eq(dailyReportRuns.id, id)).limit(1);
  if (!run) throw appError("Daily report run not found", 404, "REPORT_RUN_NOT_FOUND");
  const deliveries = await db.select().from(dailyReportDeliveries).where(eq(dailyReportDeliveries.reportRunId, id)).orderBy(asc(dailyReportDeliveries.recipientEmail));
  return { run, deliveries };
}

export async function recordDailyReportDelivery(input: { runId: string; recipientEmail: string; status: "SENT" | "FAILED" | "UNKNOWN"; errorMessage?: string }) {
  const [delivery] = await db.select().from(dailyReportDeliveries).where(and(eq(dailyReportDeliveries.reportRunId, input.runId), eq(dailyReportDeliveries.recipientEmail, input.recipientEmail))).limit(1);
  if (!delivery) throw appError("Report delivery reservation not found", 404, "REPORT_DELIVERY_NOT_FOUND");
  if (delivery.deliveryStatus === input.status && (input.status !== "FAILED" || (delivery.errorMessage ?? "") === (input.errorMessage ?? ""))) return { updated: false, idempotent: true };
  await db.update(dailyReportDeliveries).set({ deliveryStatus: input.status, sentAt: input.status === "SENT" ? new Date() : null, errorMessage: input.errorMessage ?? null }).where(eq(dailyReportDeliveries.id, delivery.id));
  const all = await db.select({ status: dailyReportDeliveries.deliveryStatus }).from(dailyReportDeliveries).where(eq(dailyReportDeliveries.reportRunId, input.runId));
  if (all.every((x) => x.status !== "PENDING")) {
    const runStatus = all.every((x) => x.status === "SENT") ? "SENT" : all.some((x) => x.status === "SENT") ? "PARTIAL_FAILED" : "FAILED";
    await db.update(dailyReportRuns).set({ status: runStatus }).where(eq(dailyReportRuns.id, input.runId));
    await db.insert(auditLogs).values({ action: runStatus === "SENT" ? "REPORT_SENT" : "REPORT_DELIVERY_COMPLETED", module: "REPORTING", entityType: "daily_report_run", entityId: input.runId, afterData: { status: runStatus }, source: "SYSTEM" });
  }
  return { updated: true };
}
