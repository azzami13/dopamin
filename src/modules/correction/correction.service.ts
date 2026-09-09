import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  auditLogs,
  cashCounts,
  cashierExpenseLines,
  cashierReports,
  dataCorrectionItems,
  dataCorrections,
  dataIssues,
  fundTransactions,
  journalEntries,
  journalLines,
  menuPriceHistory,
  paymentLines,
  rawSubmissions,
  salesReportItems,
  salesReports,
} from "@/db/schema";
import type { ActorContext } from "@/lib/auth/authorization";
import { assertPermission } from "@/lib/auth/authorization";
import { Permission } from "@/lib/auth/permissions";
import { appError } from "@/lib/http/api";
import { evaluateDailyClosing } from "@/modules/reporting/closing.service";

export type CorrectableEntity = "PAYMENT_LINE" | "CASHIER_EXPENSE_LINE" | "CASH_COUNT" | "SALES_REPORT_ITEM" | "CASHIER_REPORT" | "SALES_REPORT";

function money(value: unknown): string {
  const d = new Decimal(String(value));
  if (!d.isFinite() || d.lt(0)) throw appError("Corrected money value must be zero or greater", 422, "INVALID_CORRECTION_VALUE");
  return d.toFixed(2);
}
function quantity(value: unknown, integer = false): string | number {
  const d = new Decimal(String(value));
  if (!d.isFinite() || d.lt(0) || (integer && !d.isInteger())) throw appError("Corrected quantity must be zero or greater", 422, "INVALID_CORRECTION_VALUE");
  return integer ? d.toNumber() : d.toFixed(3);
}
function dateValue(value: unknown): string {
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) throw appError("Corrected Business Date is invalid", 422, "INVALID_CORRECTION_VALUE");
  return text;
}
function textValue(value: unknown): string | null { const t = String(value ?? "").trim(); return t || null; }
function no(prefix: string, businessDate: string) { return `${prefix}-${businessDate.replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`; }

async function sourceContext(tx: any, entityType: CorrectableEntity, entityId: string) {
  if (entityType === "CASHIER_REPORT") {
    const [r] = await tx.select({ sourceSubmissionId: cashierReports.sourceSubmissionId, businessDate: cashierReports.businessDate, status: cashierReports.reportStatus }).from(cashierReports).where(eq(cashierReports.id, entityId)).limit(1);
    return r ? { ...r, parentType: "CASHIER" as const, parentId: entityId } : null;
  }
  if (entityType === "SALES_REPORT") {
    const [r] = await tx.select({ sourceSubmissionId: salesReports.sourceSubmissionId, businessDate: salesReports.businessDate, status: salesReports.reportStatus }).from(salesReports).where(eq(salesReports.id, entityId)).limit(1);
    return r ? { ...r, parentType: "SALES" as const, parentId: entityId } : null;
  }
  if (entityType === "PAYMENT_LINE") {
    const [r] = await tx.select({ sourceSubmissionId: cashierReports.sourceSubmissionId, businessDate: cashierReports.businessDate, status: cashierReports.reportStatus, parentId: cashierReports.id }).from(paymentLines).innerJoin(cashierReports, eq(paymentLines.cashierReportId, cashierReports.id)).where(eq(paymentLines.id, entityId)).limit(1);
    return r ? { ...r, parentType: "CASHIER" as const } : null;
  }
  if (entityType === "CASHIER_EXPENSE_LINE") {
    const [r] = await tx.select({ sourceSubmissionId: cashierReports.sourceSubmissionId, businessDate: cashierReports.businessDate, status: cashierReports.reportStatus, parentId: cashierReports.id }).from(cashierExpenseLines).innerJoin(cashierReports, eq(cashierExpenseLines.cashierReportId, cashierReports.id)).where(eq(cashierExpenseLines.id, entityId)).limit(1);
    return r ? { ...r, parentType: "CASHIER" as const } : null;
  }
  if (entityType === "CASH_COUNT") {
    const [r] = await tx.select({ sourceSubmissionId: cashierReports.sourceSubmissionId, businessDate: cashierReports.businessDate, status: cashierReports.reportStatus, parentId: cashierReports.id }).from(cashCounts).innerJoin(cashierReports, eq(cashCounts.cashierReportId, cashierReports.id)).where(eq(cashCounts.id, entityId)).limit(1);
    return r ? { ...r, parentType: "CASHIER" as const } : null;
  }
  const [r] = await tx.select({ sourceSubmissionId: salesReports.sourceSubmissionId, businessDate: salesReports.businessDate, status: salesReports.reportStatus, parentId: salesReports.id }).from(salesReportItems).innerJoin(salesReports, eq(salesReportItems.salesReportId, salesReports.id)).where(eq(salesReportItems.id, entityId)).limit(1);
  return r ? { ...r, parentType: "SALES" as const } : null;
}

async function applyField(tx: any, entityType: CorrectableEntity, entityId: string, fieldName: string, newValue: unknown): Promise<{ oldValue: unknown; normalizedNewValue: unknown }> {
  if (entityType === "PAYMENT_LINE") {
    if (fieldName !== "amount") throw appError("Only amount is correctable for payment lines", 422, "FIELD_NOT_CORRECTABLE");
    const [row] = await tx.select({ amount: paymentLines.amount }).from(paymentLines).where(eq(paymentLines.id, entityId)).limit(1); if (!row) throw appError("Payment line not found", 404, "ENTITY_NOT_FOUND");
    const v = money(newValue); await tx.update(paymentLines).set({ amount: v }).where(eq(paymentLines.id, entityId)); return { oldValue: row.amount, normalizedNewValue: v };
  }
  if (entityType === "CASHIER_EXPENSE_LINE") {
    const [row] = await tx.select().from(cashierExpenseLines).where(eq(cashierExpenseLines.id, entityId)).limit(1); if (!row) throw appError("Cashier expense line not found", 404, "ENTITY_NOT_FOUND");
    if (fieldName === "amount") { const v = money(newValue); await tx.update(cashierExpenseLines).set({ amount: v }).where(eq(cashierExpenseLines.id, entityId)); return { oldValue: row.amount, normalizedNewValue: v }; }
    if (fieldName === "staff_name_raw") { const v = textValue(newValue); await tx.update(cashierExpenseLines).set({ staffNameRaw: v }).where(eq(cashierExpenseLines.id, entityId)); return { oldValue: row.staffNameRaw, normalizedNewValue: v }; }
    if (fieldName === "description") { const v = textValue(newValue); await tx.update(cashierExpenseLines).set({ description: v }).where(eq(cashierExpenseLines.id, entityId)); return { oldValue: row.description, normalizedNewValue: v }; }
    throw appError("Field is not correctable for cashier expense line", 422, "FIELD_NOT_CORRECTABLE");
  }
  if (entityType === "CASH_COUNT") {
    if (fieldName !== "quantity") throw appError("Only quantity is correctable for cash count", 422, "FIELD_NOT_CORRECTABLE");
    const [row] = await tx.select({ quantity: cashCounts.quantity }).from(cashCounts).where(eq(cashCounts.id, entityId)).limit(1); if (!row) throw appError("Cash count not found", 404, "ENTITY_NOT_FOUND");
    const v = quantity(newValue, true) as number; await tx.update(cashCounts).set({ quantity: v }).where(eq(cashCounts.id, entityId)); return { oldValue: row.quantity, normalizedNewValue: v };
  }
  if (entityType === "SALES_REPORT_ITEM") {
    if (fieldName !== "quantity") throw appError("Only quantity is correctable for sales report item in MVP", 422, "FIELD_NOT_CORRECTABLE");
    const [row] = await tx.select({ quantity: salesReportItems.quantity }).from(salesReportItems).where(eq(salesReportItems.id, entityId)).limit(1); if (!row) throw appError("Sales report item not found", 404, "ENTITY_NOT_FOUND");
    const v = quantity(newValue) as string; await tx.update(salesReportItems).set({ quantity: v }).where(eq(salesReportItems.id, entityId)); return { oldValue: row.quantity, normalizedNewValue: v };
  }
  if (entityType === "CASHIER_REPORT") {
    const [row] = await tx.select().from(cashierReports).where(eq(cashierReports.id, entityId)).limit(1); if (!row) throw appError("Cashier report not found", 404, "ENTITY_NOT_FOUND");
    if (fieldName === "business_date") { const v = dateValue(newValue); await tx.update(cashierReports).set({ businessDate: v }).where(eq(cashierReports.id, entityId)); return { oldValue: row.businessDate, normalizedNewValue: v }; }
    if (fieldName === "cashier_name_raw") { const v = textValue(newValue); await tx.update(cashierReports).set({ cashierNameRaw: v }).where(eq(cashierReports.id, entityId)); return { oldValue: row.cashierNameRaw, normalizedNewValue: v }; }
    if (fieldName === "shift_code") { const v = textValue(newValue); await tx.update(cashierReports).set({ shiftCode: v }).where(eq(cashierReports.id, entityId)); return { oldValue: row.shiftCode, normalizedNewValue: v }; }
    if (fieldName === "opening_closing_status") { const v = textValue(newValue); await tx.update(cashierReports).set({ openingClosingStatus: v }).where(eq(cashierReports.id, entityId)); return { oldValue: row.openingClosingStatus, normalizedNewValue: v }; }
    if (fieldName === "petty_cash_amount") { const v = money(newValue); await tx.update(cashierReports).set({ pettyCashAmount: v }).where(eq(cashierReports.id, entityId)); return { oldValue: row.pettyCashAmount, normalizedNewValue: v }; }
    if (fieldName === "cash_outside_petty_amount") { const v = money(newValue); await tx.update(cashierReports).set({ cashOutsidePettyAmount: v }).where(eq(cashierReports.id, entityId)); return { oldValue: row.cashOutsidePettyAmount, normalizedNewValue: v }; }
    throw appError("Field is not correctable for cashier report", 422, "FIELD_NOT_CORRECTABLE");
  }
  const [row] = await tx.select().from(salesReports).where(eq(salesReports.id, entityId)).limit(1); if (!row) throw appError("Sales report not found", 404, "ENTITY_NOT_FOUND");
  if (fieldName === "business_date") {
    const v = dateValue(newValue);
    const items = await tx.select({ id: salesReportItems.id, menuItemId: salesReportItems.menuItemId }).from(salesReportItems).where(eq(salesReportItems.salesReportId, entityId));
    for (const item of items) {
      const [price] = await tx.select({ id: menuPriceHistory.id, price: menuPriceHistory.price }).from(menuPriceHistory)
        .where(and(eq(menuPriceHistory.menuItemId, item.menuItemId), lte(menuPriceHistory.effectiveFrom, v), or(isNull(menuPriceHistory.effectiveTo), gte(menuPriceHistory.effectiveTo, v))))
        .orderBy(desc(menuPriceHistory.effectiveFrom)).limit(1);
      if (!price) throw appError(`No effective menu price exists for corrected Business Date ${v}`, 409, "PRICE_NOT_FOUND_FOR_CORRECTED_DATE");
      await tx.update(salesReportItems).set({ menuPriceHistoryId: price.id, unitPriceSnapshot: price.price }).where(eq(salesReportItems.id, item.id));
    }
    await tx.update(salesReports).set({ businessDate: v }).where(eq(salesReports.id, entityId));
    return { oldValue: row.businessDate, normalizedNewValue: v };
  }
  if (fieldName === "inputter_name_raw") { const v = textValue(newValue); await tx.update(salesReports).set({ inputterNameRaw: v }).where(eq(salesReports.id, entityId)); return { oldValue: row.inputterNameRaw, normalizedNewValue: v }; }
  throw appError("Field is not correctable for sales report", 422, "FIELD_NOT_CORRECTABLE");
}

export async function createCorrection(actor: ActorContext, input: { entityType: CorrectableEntity; entityId: string; fieldName: string; newValue: unknown; reason: string; issueId?: string }) {
  assertPermission(actor, Permission.CORRECTION_CREATE);
  if (!input.reason.trim()) throw appError("Correction reason is required", 422, "CORRECTION_REASON_REQUIRED");
  const result = await db.transaction(async (tx) => {
    const initialContext = await sourceContext(tx, input.entityType, input.entityId);
    if (!initialContext) throw appError("Correctable entity not found", 404, "ENTITY_NOT_FOUND");
    const [sourceIdentity] = await tx.select({ sourceId: rawSubmissions.dataSourceId }).from(rawSubmissions).where(eq(rawSubmissions.id, initialContext.sourceSubmissionId));
    if (!sourceIdentity) throw appError("Raw source not found", 404);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${sourceIdentity.sourceId}, 0))`);
    const contextBefore = await sourceContext(tx, input.entityType, input.entityId);
    if (!contextBefore) throw appError("Correctable entity not found", 404, "ENTITY_NOT_FOUND");
    if (contextBefore.status === "SUPERSEDED") throw appError("Superseded source records cannot be corrected", 409, "SOURCE_SUPERSEDED");
    const [raw] = await tx.select({ status: rawSubmissions.processingStatus }).from(rawSubmissions).where(eq(rawSubmissions.id, contextBefore.sourceSubmissionId)).limit(1);
    if (!raw || raw.status === "SUPERSEDED") throw appError("Raw source is superseded or unavailable", 409, "SOURCE_SUPERSEDED");

    const field = await applyField(tx, input.entityType, input.entityId, input.fieldName, input.newValue);
    const [correction] = await tx.insert(dataCorrections).values({ createdBy: actor.userId, entityType: input.entityType, entityId: input.entityId, reason: input.reason.trim(), status: "ACTIVE" }).returning({ id: dataCorrections.id });
    await tx.insert(dataCorrectionItems).values({ correctionId: correction.id, fieldName: input.fieldName, oldValue: field.oldValue as any, newValue: field.normalizedNewValue as any });

    if (input.issueId) {
      const [issue] = await tx.select().from(dataIssues).where(eq(dataIssues.id, input.issueId)).limit(1);
      if (!issue || issue.sourceSubmissionId !== contextBefore.sourceSubmissionId) throw appError("Data issue does not belong to the corrected source", 422, "ISSUE_SOURCE_MISMATCH");
      if (issue.status === "OPEN") await tx.update(dataIssues).set({ status: "RESOLVED", resolvedAt: new Date(), resolvedBy: actor.userId }).where(eq(dataIssues.id, issue.id));
    }
    const remaining = await tx.select({ id: dataIssues.id }).from(dataIssues).where(and(eq(dataIssues.sourceSubmissionId, contextBefore.sourceSubmissionId), eq(dataIssues.status, "OPEN"))).limit(1);
    if (!remaining.length) {
      await tx.update(rawSubmissions).set({ processingStatus: "VALID" }).where(eq(rawSubmissions.id, contextBefore.sourceSubmissionId));
      if (contextBefore.parentType === "CASHIER") await tx.update(cashierReports).set({ reportStatus: "VALID" }).where(eq(cashierReports.id, contextBefore.parentId));
      else await tx.update(salesReports).set({ reportStatus: "VALID" }).where(eq(salesReports.id, contextBefore.parentId));
    }
    const contextAfter = await sourceContext(tx, input.entityType, input.entityId);
    await tx.insert(auditLogs).values({ actorUserId: actor.userId, actorRole: actor.role, action: "CORRECTION", module: "CORRECTION", entityType: input.entityType, entityId: input.entityId, beforeData: { field: input.fieldName, value: field.oldValue }, afterData: { field: input.fieldName, value: field.normalizedNewValue, correctionId: correction.id }, reason: input.reason.trim(), source: "WEB" });
    return { correctionId: correction.id, oldValue: field.oldValue, newValue: field.normalizedNewValue, oldBusinessDate: contextBefore.businessDate, newBusinessDate: contextAfter?.businessDate ?? contextBefore.businessDate };
  });
  await evaluateDailyClosing(result.oldBusinessDate, actor.userId);
  if (result.newBusinessDate !== result.oldBusinessDate) await evaluateDailyClosing(result.newBusinessDate, actor.userId);
  return result;
}

export async function listDataIssues(actor: ActorContext, input?: { status?: string; severity?: string }) {
  assertPermission(actor, Permission.DATA_ISSUE_VIEW);
  let modules: string[] | null = null;
  if (actor.role === "CASHIER") modules = ["CASHIER", "BEVERAGE"];
  if (actor.role === "KITCHEN") modules = ["KITCHEN"];
  const predicates = [];
  if (input?.status) predicates.push(eq(dataIssues.status, input.status));
  if (input?.severity) predicates.push(eq(dataIssues.severity, input.severity));
  if (modules) predicates.push(inArray(dataIssues.module, modules));
  return db.select().from(dataIssues).where(predicates.length ? and(...predicates) : undefined).orderBy(desc(dataIssues.createdAt));
}

export async function voidFundTransaction(actor: ActorContext, transactionId: string, reason: string) {
  assertPermission(actor, Permission.FINANCE_VOID);
  if (!reason.trim()) throw appError("Void reason is required", 422, "VOID_REASON_REQUIRED");
  return db.transaction(async (tx) => {
    const [transaction] = await tx.select().from(fundTransactions).where(eq(fundTransactions.id, transactionId)).limit(1);
    if (!transaction) throw appError("Fund transaction not found", 404, "FUND_TRANSACTION_NOT_FOUND");
    if (transaction.status !== "POSTED") throw appError("Only POSTED fund transactions can be voided", 409, "FUND_TRANSACTION_ALREADY_VOID");
    const [originalJournal] = await tx.select().from(journalEntries).where(and(eq(journalEntries.sourceType, "FUND_TRANSACTION"), eq(journalEntries.sourceId, transactionId), eq(journalEntries.status, "POSTED"))).limit(1);
    if (!originalJournal) throw appError("Posted journal for fund transaction was not found", 409, "JOURNAL_NOT_FOUND");
    const originalLines = await tx.select().from(journalLines).where(eq(journalLines.journalEntryId, originalJournal.id));
    if (originalLines.length < 2) throw appError("Original journal is incomplete", 409, "JOURNAL_INVALID");

    await tx.update(fundTransactions).set({ status: "VOID" }).where(eq(fundTransactions.id, transactionId));
    // The original POSTED journal remains immutable. A separate posted reversal offsets it.
    const [reversal] = await tx.insert(journalEntries).values({ createdBy: actor.userId, reversedEntryId: originalJournal.id, entryNo: no("REV", transaction.businessDate), businessDate: transaction.businessDate, sourceType: "FUND_TRANSACTION_REVERSAL", sourceId: transactionId, description: `Reversal: ${transaction.description ?? transaction.transactionNo}`, status: "POSTED" }).returning({ id: journalEntries.id, entryNo: journalEntries.entryNo });
    await tx.insert(journalLines).values(originalLines.map((line) => ({ journalEntryId: reversal.id, accountId: line.accountId, debit: line.credit, credit: line.debit, memo: `Reversal of ${originalJournal.entryNo}` })));
    await tx.insert(auditLogs).values({ actorUserId: actor.userId, actorRole: actor.role, action: "VOID", module: "FINANCE", entityType: "fund_transaction", entityId: transactionId, beforeData: { status: "POSTED", transactionNo: transaction.transactionNo, journalEntryId: originalJournal.id }, afterData: { status: "VOID", reversalJournalEntryId: reversal.id, reversalEntryNo: reversal.entryNo }, reason: reason.trim(), source: "WEB" });
    return { transactionId, transactionNo: transaction.transactionNo, status: "VOID", reversalJournalEntryId: reversal.id, reversalEntryNo: reversal.entryNo, purchaseRequestReviewRequired: Boolean(transaction.purchaseRequestId) };
  });
}

export async function correctionTargetForIssue(actor: ActorContext, issueId: string) {
  assertPermission(actor, Permission.DATA_ISSUE_VIEW);
  const [issue] = await db.select().from(dataIssues).where(eq(dataIssues.id, issueId)).limit(1);
  if (!issue) throw appError("Data issue not found", 404, "DATA_ISSUE_NOT_FOUND");
  const allowed = actor.role === "CASHIER" ? ["CASHIER", "BEVERAGE"] : actor.role === "KITCHEN" ? ["KITCHEN"] : null;
  if (allowed && !allowed.includes(issue.module)) throw appError("Data issue is outside role scope", 403, "DATA_ISSUE_SCOPE_DENIED");
  if (!issue.sourceSubmissionId || !issue.fieldName) return { issue, target: null, reason: "Issue has no source field target; resolve through master/mapping/reprocess workflow." };

  const [cashier] = await db.select({ id: cashierReports.id }).from(cashierReports).where(eq(cashierReports.sourceSubmissionId, issue.sourceSubmissionId)).limit(1);
  if (cashier) {
    const [payment] = await db.select({ id: paymentLines.id, amount: paymentLines.amount }).from(paymentLines).where(and(eq(paymentLines.cashierReportId, cashier.id), eq(paymentLines.sourceField, issue.fieldName))).limit(1);
    if (payment) return { issue, target: { entityType: "PAYMENT_LINE" as const, entityId: payment.id, fieldName: "amount", currentValue: payment.amount } };
    const [expense] = await db.select({ id: cashierExpenseLines.id, amount: cashierExpenseLines.amount }).from(cashierExpenseLines).where(and(eq(cashierExpenseLines.cashierReportId, cashier.id), eq(cashierExpenseLines.sourceField, issue.fieldName))).limit(1);
    if (expense) return { issue, target: { entityType: "CASHIER_EXPENSE_LINE" as const, entityId: expense.id, fieldName: "amount", currentValue: expense.amount } };
    const [count] = await db.select({ id: cashCounts.id, quantity: cashCounts.quantity }).from(cashCounts).where(and(eq(cashCounts.cashierReportId, cashier.id), eq(cashCounts.sourceField, issue.fieldName))).limit(1);
    if (count) return { issue, target: { entityType: "CASH_COUNT" as const, entityId: count.id, fieldName: "quantity", currentValue: count.quantity } };
  }
  const [sales] = await db.select({ id: salesReports.id }).from(salesReports).where(eq(salesReports.sourceSubmissionId, issue.sourceSubmissionId)).limit(1);
  if (sales) {
    const [item] = await db.select({ id: salesReportItems.id, quantity: salesReportItems.quantity }).from(salesReportItems).where(and(eq(salesReportItems.salesReportId, sales.id), eq(salesReportItems.sourceField, issue.fieldName))).limit(1);
    if (item) return { issue, target: { entityType: "SALES_REPORT_ITEM" as const, entityId: item.id, fieldName: "quantity", currentValue: item.quantity } };
  }
  return { issue, target: null, reason: "No normalized line exists for this source field. The issue requires master/mapping correction or raw-source reprocessing, which is not converted into a line correction automatically." };
}
