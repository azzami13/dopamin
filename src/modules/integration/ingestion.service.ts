import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs, cashierReports, dataIssues, dataSources, rawSubmissions, salesReports } from "@/db/schema";
import { stableStringify } from "@/lib/integration/canonical-json";
import { normalizeCashier, normalizeSales } from "./normalizers";
import type { GoogleFormEnvelope } from "./types";
import { evaluateDailyClosing } from "@/modules/reporting/closing.service";

function canonicalSourceKey(sourceKey: string): "CASHIER" | "KITCHEN" | "BEVERAGE" | "OPEX" | null {
  const upper = sourceKey.trim().toUpperCase();
  if (upper.startsWith("CASHIER")) return "CASHIER";
  if (upper.startsWith("KITCHEN")) return "KITCHEN";
  if (upper.startsWith("BEVERAGE")) return "BEVERAGE";
  if (upper.startsWith("OPEX")) return "OPEX";
  return null;
}

export async function ingestGoogleForm(envelope: GoogleFormEnvelope, correlationId: string) {
  const sourceCode = canonicalSourceKey(envelope.sourceKey);
  if (!sourceCode || sourceCode === "OPEX") throw Object.assign(new Error("Unsupported Google Form sourceKey"), { status: 400, code: "SOURCE_NOT_SUPPORTED" });

  const [source] = await db.select().from(dataSources).where(and(eq(dataSources.code, sourceCode), eq(dataSources.isActive, true))).limit(1);
  if (!source) throw Object.assign(new Error("Data source is not configured or active"), { status: 404, code: "SOURCE_NOT_CONFIGURED" });
  if (source.spreadsheetId && source.spreadsheetId !== envelope.spreadsheetId) throw Object.assign(new Error("Spreadsheet ID does not match configured source"), { status: 409, code: "SOURCE_ID_MISMATCH" });
  if (source.sheetName && source.sheetName !== envelope.sheetName) throw Object.assign(new Error("Sheet name does not match configured source"), { status: 409, code: "SOURCE_SHEET_MISMATCH" });

  const payloadHash = createHash("sha256").update(stableStringify(envelope.payload), "utf8").digest("hex");
  return db.transaction(async (tx) => {
    // Serialize revision selection and normalization for this configured source.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${source.id}, 0))`);
    const [samePayload] = await tx.select().from(rawSubmissions).where(and(eq(rawSubmissions.dataSourceId, source.id), eq(rawSubmissions.sourceRecordKey, envelope.rowKey), eq(rawSubmissions.payloadHash, payloadHash))).limit(1);
    if (samePayload) {
      if (samePayload.processingStatus === "ERROR" || samePayload.processingStatus === "PROCESSING") {
        throw Object.assign(new Error("Stored submission requires controlled reprocessing"), { status: 409, code: "REPROCESS_REQUIRED" });
      }
      return { idempotent: true, rawSubmissionId: samePayload.id, status: samePayload.processingStatus, revision: samePayload.sourceRevision };
    }
    const [previous] = await tx.select().from(rawSubmissions).where(and(eq(rawSubmissions.dataSourceId, source.id), eq(rawSubmissions.sourceRecordKey, envelope.rowKey))).orderBy(desc(rawSubmissions.sourceRevision)).limit(1);
    const revision = (previous?.sourceRevision ?? 0) + 1;
    const [raw] = await tx.insert(rawSubmissions).values({
      dataSourceId: source.id,
      sourceRecordKey: envelope.rowKey,
      sourceRevision: revision,
      supersedesSubmissionId: previous?.id,
      submittedAt: new Date(envelope.submittedAt),
      payloadHash,
      rawPayload: envelope.payload,
      processingStatus: "PROCESSING",
    }).returning({ id: rawSubmissions.id });
    let result;
    try {
      // A savepoint rolls back partial normalization, while retaining the raw evidence.
      result = await tx.transaction(async (normalizationTx) => sourceCode === "CASHIER"
        ? normalizeCashier({ dataSourceId: source.id, rawSubmissionId: raw.id, envelope }, normalizationTx)
        : normalizeSales({ source: sourceCode, dataSourceId: source.id, rawSubmissionId: raw.id, envelope }, normalizationTx));
    } catch {
      await tx.update(rawSubmissions).set({ processingStatus: "ERROR" }).where(eq(rawSubmissions.id, raw.id));
      await tx.insert(dataIssues).values({ sourceSubmissionId: raw.id, module: "INTEGRATION", severity: "CRITICAL", issueCode: "NORMALIZATION_ERROR", message: "Normalization failed; inspect mappings/master data and use controlled reprocess." });
      await tx.insert(auditLogs).values({ action: "INGESTION_ERROR", module: "INTEGRATION", entityType: "raw_submission", entityId: raw.id, afterData: { revision }, source: "GOOGLE_SCRIPT", correlationId });
      // Retain earlier rows, but don't present an outdated version as final/complete.
      const earlier = await tx.select({ id: rawSubmissions.id }).from(rawSubmissions).where(and(eq(rawSubmissions.dataSourceId, source.id), eq(rawSubmissions.sourceRecordKey, envelope.rowKey)));
      const dates = new Set<string>();
      for (const submission of earlier) {
        const cashier = await tx.update(cashierReports).set({ reportStatus: "NEEDS_REVIEW" }).where(and(eq(cashierReports.sourceSubmissionId, submission.id), sql`${cashierReports.reportStatus} <> 'SUPERSEDED'`)).returning({ date: cashierReports.businessDate });
        const sales = await tx.update(salesReports).set({ reportStatus: "NEEDS_REVIEW" }).where(and(eq(salesReports.sourceSubmissionId, submission.id), sql`${salesReports.reportStatus} <> 'SUPERSEDED'`)).returning({ date: salesReports.businessDate });
        for (const row of [...cashier, ...sales]) dates.add(row.date);
      }
      for (const date of [...dates].sort()) await evaluateDailyClosing(date, undefined, tx);
      return { idempotent: false, rawSubmissionId: raw.id, revision, status: "ERROR" as const };
    }
    await supersedeEarlierReports(tx, source.id, envelope.rowKey, raw.id);
    await tx.update(rawSubmissions).set({ processingStatus: result.status, businessDateDetected: result.businessDate }).where(eq(rawSubmissions.id, raw.id));
    await tx.insert(auditLogs).values({
      action: "INGESTION_PROCESSED", module: "INTEGRATION", entityType: "raw_submission", entityId: raw.id,
      afterData: { sourceCode, revision, status: result.status, issueCount: result.issueCount, businessDate: result.businessDate },
      source: "GOOGLE_SCRIPT", correlationId,
    });
    if (result.businessDate) await evaluateDailyClosing(result.businessDate, undefined, tx);
    return { idempotent: false, rawSubmissionId: raw.id, revision, ...result };
  });
}

export async function supersedeEarlierReports(tx: import("./normalizers").IntegrationTx, sourceId: string, rowKey: string, currentId: string) {
  const earlier = await tx.select().from(rawSubmissions).where(and(eq(rawSubmissions.dataSourceId, sourceId), eq(rawSubmissions.sourceRecordKey, rowKey)));
  const dates = new Set<string>();
  for (const previous of earlier) {
    if (previous.id === currentId) continue;
    await tx.update(rawSubmissions).set({ processingStatus: "SUPERSEDED" }).where(eq(rawSubmissions.id, previous.id));
    const cashier = await tx.update(cashierReports).set({ reportStatus: "SUPERSEDED" }).where(eq(cashierReports.sourceSubmissionId, previous.id)).returning({ date: cashierReports.businessDate });
    const sales = await tx.update(salesReports).set({ reportStatus: "SUPERSEDED" }).where(eq(salesReports.sourceSubmissionId, previous.id)).returning({ date: salesReports.businessDate });
    for (const row of [...cashier, ...sales]) dates.add(row.date);
  }
  for (const date of [...dates].sort()) await evaluateDailyClosing(date, undefined, tx);
}
