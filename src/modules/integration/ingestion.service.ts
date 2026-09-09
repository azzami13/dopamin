import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
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
  if (source.spreadsheetId && envelope.spreadsheetId && source.spreadsheetId !== envelope.spreadsheetId) throw Object.assign(new Error("Spreadsheet ID does not match configured source"), { status: 409, code: "SOURCE_ID_MISMATCH" });
  if (source.sheetName && envelope.sheetName && source.sheetName !== envelope.sheetName) throw Object.assign(new Error("Sheet name does not match configured source"), { status: 409, code: "SOURCE_SHEET_MISMATCH" });

  const payloadHash = createHash("sha256").update(stableStringify(envelope.payload), "utf8").digest("hex");
  const [samePayload] = await db.select().from(rawSubmissions).where(and(eq(rawSubmissions.dataSourceId, source.id), eq(rawSubmissions.sourceRecordKey, envelope.rowKey), eq(rawSubmissions.payloadHash, payloadHash))).limit(1);
  if (samePayload) return { idempotent: true, rawSubmissionId: samePayload.id, status: samePayload.processingStatus, revision: samePayload.sourceRevision };

  const revisionState = await db.transaction(async (tx) => {
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
    if (previous) {
      await tx.update(rawSubmissions).set({ processingStatus: "SUPERSEDED" }).where(eq(rawSubmissions.id, previous.id));
      await tx.update(cashierReports).set({ reportStatus: "SUPERSEDED" }).where(eq(cashierReports.sourceSubmissionId, previous.id));
      await tx.update(salesReports).set({ reportStatus: "SUPERSEDED" }).where(eq(salesReports.sourceSubmissionId, previous.id));
    }
    return { raw, revision };
  });
  const { raw, revision } = revisionState;

  try {
    const result = sourceCode === "CASHIER"
      ? await normalizeCashier({ dataSourceId: source.id, rawSubmissionId: raw.id, envelope })
      : await normalizeSales({ source: sourceCode, dataSourceId: source.id, rawSubmissionId: raw.id, envelope });
    await db.update(rawSubmissions).set({ processingStatus: result.status, businessDateDetected: result.businessDate }).where(eq(rawSubmissions.id, raw.id));
    await db.insert(auditLogs).values({
      action: "INGESTION_PROCESSED", module: "INTEGRATION", entityType: "raw_submission", entityId: raw.id,
      afterData: { sourceCode, revision, status: result.status, issueCount: result.issueCount, businessDate: result.businessDate },
      source: "GOOGLE_SCRIPT", correlationId,
    });
    if (result.businessDate) await evaluateDailyClosing(result.businessDate);
    return { idempotent: false, rawSubmissionId: raw.id, revision, ...result };
  } catch (error) {
    await db.update(rawSubmissions).set({ processingStatus: "ERROR" }).where(eq(rawSubmissions.id, raw.id));
    await db.insert(dataIssues).values({ sourceSubmissionId: raw.id, module: "INTEGRATION", severity: "CRITICAL", issueCode: "NORMALIZATION_ERROR", message: error instanceof Error ? error.message : "Unknown normalization error" });
    throw error;
  }
}
