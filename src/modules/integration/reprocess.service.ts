import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs, dataCorrections, dataIssues, dataSources, rawSubmissions } from "@/db/schema";
import { assertPermission, type ActorContext } from "@/lib/auth/authorization";
import { Permission } from "@/lib/auth/permissions";
import { appError } from "@/lib/http/api";
import { evaluateDailyClosing } from "@/modules/reporting/closing.service";
import { normalizeCashier, normalizeSales } from "./normalizers";
import { supersedeEarlierReports } from "./ingestion.service";

export async function reprocessSubmission(actor: ActorContext, id: string, reason: string) {
  assertPermission(actor, Permission.SETTINGS_MANAGE);
  assertPermission(actor, Permission.CORRECTION_CREATE);
  if (!reason.trim()) throw appError("Reprocess reason is required");
  return db.transaction(async (tx) => {
    const [identity] = await tx.select().from(rawSubmissions).where(eq(rawSubmissions.id, id));
    if (!identity) throw appError("Submission not found", 404);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${identity.dataSourceId}, 0))`);
    const [raw] = await tx.select().from(rawSubmissions).where(eq(rawSubmissions.id, id));
    const [latest] = await tx.select().from(rawSubmissions).where(and(eq(rawSubmissions.dataSourceId, raw.dataSourceId), eq(rawSubmissions.sourceRecordKey, raw.sourceRecordKey))).orderBy(desc(rawSubmissions.sourceRevision)).limit(1);
    if (latest.id !== id || !["ERROR", "NEEDS_REVIEW"].includes(raw.processingStatus)) throw appError("Only latest ERROR/NEEDS_REVIEW submissions may be reprocessed", 409, "REPROCESS_NOT_ALLOWED");
    const [source] = await tx.select().from(dataSources).where(eq(dataSources.id, raw.dataSourceId));
    if (!source?.isActive || !["CASHIER", "KITCHEN", "BEVERAGE"].includes(source.code)) throw appError("Source is inactive or unsupported", 409);
    // Snapshot every normalized row before rebuilding incomplete, uncorrected data.
    const before = await tx.execute(sql`
      select to_jsonb(cr) as report,
        (select coalesce(jsonb_agg(to_jsonb(p)), '[]') from payment_lines p where p.cashier_report_id=cr.id) as payments,
        (select coalesce(jsonb_agg(to_jsonb(e)), '[]') from cashier_expense_lines e where e.cashier_report_id=cr.id) as expenses,
        (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from cash_counts c where c.cashier_report_id=cr.id) as counts
      from cashier_reports cr where cr.source_submission_id=${id}::uuid
    `);
    const beforeSales = await tx.execute(sql`
      select to_jsonb(sr) as report,
        (select coalesce(jsonb_agg(to_jsonb(i)), '[]') from sales_report_items i where i.sales_report_id=sr.id) as items
      from sales_reports sr where sr.source_submission_id=${id}::uuid
    `);
    const snapshots = [...before, ...beforeSales] as Record<string, unknown>[];
    const entities: string[] = [id];
    for (const snapshot of snapshots) {
      const report = snapshot.report as { id: string; report_status: string };
      if (report.report_status !== "NEEDS_REVIEW") throw appError("Effective/valid reports require the correction workflow", 409);
      entities.push(report.id);
      for (const key of ["payments", "expenses", "counts", "items"]) {
        for (const line of (snapshot[key] ?? []) as { id: string }[]) entities.push(line.id);
      }
    }
    const [correction] = await tx.select({ id: dataCorrections.id }).from(dataCorrections).where(inArray(dataCorrections.entityId, entities)).limit(1);
    const linked = await tx.execute(sql`select id from fund_transactions where source_submission_id=${id}::uuid union all select id from journal_entries where source_id in (${sql.join(entities.map((entity) => sql`${entity}::uuid`), sql`, `)}) limit 1`);
    if (correction || linked.length) throw appError("Corrected or financially linked data cannot be rebuilt", 409, "REPROCESS_HISTORY_PROTECTED");
    await tx.update(dataIssues).set({ status: "RESOLVED", resolvedAt: new Date(), resolvedBy: actor.userId }).where(and(eq(dataIssues.sourceSubmissionId, id), eq(dataIssues.status, "OPEN")));
    const envelope = { sourceKey: source.code, rowKey: raw.sourceRecordKey, submittedAt: raw.submittedAt.toISOString(), payload: raw.rawPayload };
    const result = source.code === "CASHIER"
      ? await normalizeCashier({ dataSourceId: source.id, rawSubmissionId: id, envelope }, tx)
      : await normalizeSales({ source: source.code as "KITCHEN" | "BEVERAGE", dataSourceId: source.id, rawSubmissionId: id, envelope }, tx);
    // An invalid date has no replacement report; retain existing incomplete rows as review-only.
    await supersedeEarlierReports(tx, source.id, raw.sourceRecordKey, id);
    await tx.update(rawSubmissions).set({ processingStatus: result.status, businessDateDetected: result.businessDate }).where(eq(rawSubmissions.id, id));
    await tx.insert(auditLogs).values({ actorUserId: actor.userId, actorRole: actor.role, action: "REPROCESS", module: "INTEGRATION", entityType: "raw_submission", entityId: id, beforeData: { status: raw.processingStatus, normalized: snapshots }, afterData: result, reason: reason.trim(), source: "WEB" });
    const dates = new Set<string>();
    for (const snapshot of snapshots) dates.add((snapshot.report as { business_date: string }).business_date);
    if (result.businessDate) dates.add(result.businessDate);
    for (const date of [...dates].sort()) await evaluateDailyClosing(date, undefined, tx);
    return { rawSubmissionId: id, ...result };
  });
}
