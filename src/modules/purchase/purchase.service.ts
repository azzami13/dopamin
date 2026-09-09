import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  auditLogs,
  expenseCategories,
  fundAccounts,
  fundTransactions,
  journalEntries,
  journalLines,
  purchaseReceipts,
  purchaseRequestActions,
  purchaseRequestItems,
  purchaseRequests,
  systemSettings,
} from "@/db/schema";
import type { ActorContext } from "@/lib/auth/authorization";
import { assertPermission } from "@/lib/auth/authorization";
import { Permission } from "@/lib/auth/permissions";
import { appError } from "@/lib/http/api";

export type PurchaseItemInput = { itemName: string; quantity: string; unit: string; estimatedUnitCost: string };

type PurchaseStatus =
  | "DRAFT" | "SUBMITTED" | "APPROVED" | "FUNDED_READY_TO_SPEND" | "PURCHASED"
  | "RECEIPT_RECORDED" | "CLOSED" | "REVISION_REQUESTED" | "REJECTED";

function makeNo(prefix: string, date: string) {
  return `${prefix}-${date.replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function positive(value: string, scale: number, field: string): string {
  const d = new Decimal(value);
  if (!d.isFinite() || d.lte(0)) throw appError(`${field} must be greater than zero`, 422, "INVALID_NUMBER");
  return d.toFixed(scale);
}
function nonNegative(value: string, scale: number, field: string): string {
  const d = new Decimal(value);
  if (!d.isFinite() || d.lt(0)) throw appError(`${field} must be zero or greater`, 422, "INVALID_NUMBER");
  return d.toFixed(scale);
}

function calculateEstimatedTotal(items: PurchaseItemInput[]): { normalized: PurchaseItemInput[]; total: string } {
  if (!items.length) throw appError("Purchase Request must contain at least one item", 422, "PURCHASE_ITEMS_REQUIRED");
  let total = new Decimal(0);
  const normalized = items.map((item) => {
    const quantity = positive(item.quantity, 3, "quantity");
    const estimatedUnitCost = nonNegative(item.estimatedUnitCost, 2, "estimatedUnitCost");
    if (!item.itemName.trim() || !item.unit.trim()) throw appError("Item name and unit are required", 422, "PURCHASE_ITEM_INVALID");
    total = total.plus(new Decimal(quantity).mul(estimatedUnitCost));
    return { itemName: item.itemName.trim(), unit: item.unit.trim(), quantity, estimatedUnitCost };
  });
  return { normalized, total: total.toFixed(2) };
}

async function audit(tx: any, actor: ActorContext, action: string, requestId: string, beforeData?: Record<string, unknown>, afterData?: Record<string, unknown>, reason?: string) {
  await tx.insert(auditLogs).values({
    actorUserId: actor.userId,
    actorRole: actor.role,
    action,
    module: "PURCHASE",
    entityType: "purchase_request",
    entityId: requestId,
    beforeData,
    afterData,
    reason,
    source: "WEB",
  });
}

async function requestById(tx: any, id: string) {
  const [row] = await tx.select().from(purchaseRequests).where(eq(purchaseRequests.id, id)).limit(1);
  if (!row) throw appError("Purchase Request not found", 404, "PURCHASE_REQUEST_NOT_FOUND");
  return row;
}

function assertState(current: string, allowed: PurchaseStatus[], action: string) {
  if (!allowed.includes(current as PurchaseStatus)) {
    throw appError(`Cannot ${action} Purchase Request in state ${current}`, 409, "INVALID_PURCHASE_STATE", { current, allowed });
  }
}

export async function createPurchaseRequest(actor: ActorContext, input: { requestDate: string; purpose: string; items: PurchaseItemInput[] }) {
  assertPermission(actor, Permission.PURCHASE_CREATE);
  if (!input.purpose.trim()) throw appError("Purpose is required", 422, "PURPOSE_REQUIRED");
  const { normalized, total } = calculateEstimatedTotal(input.items);
  return db.transaction(async (tx) => {
    const [request] = await tx.insert(purchaseRequests).values({
      requestedBy: actor.userId,
      requestNo: makeNo("PR", input.requestDate),
      requestDate: input.requestDate,
      purpose: input.purpose.trim(),
      estimatedTotal: total,
      status: "DRAFT",
    }).returning();
    await tx.insert(purchaseRequestItems).values(normalized.map((item) => ({ purchaseRequestId: request.id, ...item })));
    await audit(tx, actor, "CREATE", request.id, undefined, { requestNo: request.requestNo, status: request.status, estimatedTotal: total });
    return request;
  });
}

export async function updatePurchaseRequest(actor: ActorContext, id: string, input: { requestDate: string; purpose: string; items: PurchaseItemInput[] }) {
  assertPermission(actor, Permission.PURCHASE_CREATE);
  const { normalized, total } = calculateEstimatedTotal(input.items);
  return db.transaction(async (tx) => {
    const current = await requestById(tx, id);
    assertState(current.status, ["DRAFT", "REVISION_REQUESTED"], "edit");
    await tx.delete(purchaseRequestItems).where(eq(purchaseRequestItems.purchaseRequestId, id));
    await tx.insert(purchaseRequestItems).values(normalized.map((item) => ({ purchaseRequestId: id, ...item })));
    const [updated] = await tx.update(purchaseRequests).set({ requestDate: input.requestDate, purpose: input.purpose.trim(), estimatedTotal: total }).where(eq(purchaseRequests.id, id)).returning();
    await audit(tx, actor, "UPDATE", id, { requestDate: current.requestDate, purpose: current.purpose, estimatedTotal: current.estimatedTotal }, { requestDate: updated.requestDate, purpose: updated.purpose, estimatedTotal: updated.estimatedTotal });
    return updated;
  });
}

export async function submitPurchaseRequest(actor: ActorContext, id: string) {
  assertPermission(actor, Permission.PURCHASE_CREATE);
  return db.transaction(async (tx) => {
    const current = await requestById(tx, id);
    assertState(current.status, ["DRAFT", "REVISION_REQUESTED"], "submit");
    const [updated] = await tx.update(purchaseRequests).set({ status: "SUBMITTED" }).where(eq(purchaseRequests.id, id)).returning();
    await tx.insert(purchaseRequestActions).values({ purchaseRequestId: id, actorUserId: actor.userId, action: "SUBMIT" });
    await audit(tx, actor, "SUBMIT", id, { status: current.status }, { status: updated.status });
    return updated;
  });
}

export async function decidePurchaseRequest(actor: ActorContext, id: string, input: { action: "APPROVE" | "REVISE" | "REJECT"; reason?: string; fundAccountCode?: string }) {
  assertPermission(actor, Permission.PURCHASE_APPROVE);
  return db.transaction(async (tx) => {
    const current = await requestById(tx, id);
    assertState(current.status, ["SUBMITTED"], input.action.toLowerCase());
    if ((input.action === "REVISE" || input.action === "REJECT") && !input.reason?.trim()) {
      throw appError("Reason is required for Revision or Reject", 422, "DECISION_REASON_REQUIRED");
    }

    let status: PurchaseStatus;
    let approvedFundAccountId: string | null = current.approvedFundAccountId;
    if (input.action === "APPROVE") {
      status = "APPROVED";
      if (input.fundAccountCode) {
        if (!["HOUSEBANK", "CASHIER_CASH"].includes(input.fundAccountCode)) throw appError("Purchase Request funding source must be HOUSEBANK or CASHIER_CASH", 422, "PURCHASE_FUND_SOURCE_INVALID");
        const [fund] = await tx.select({ id: fundAccounts.id }).from(fundAccounts).where(and(eq(fundAccounts.code, input.fundAccountCode), eq(fundAccounts.isActive, true))).limit(1);
        if (!fund) throw appError("Funding source is not configured", 422, "FUND_ACCOUNT_NOT_CONFIGURED");
        approvedFundAccountId = fund.id;
        status = "FUNDED_READY_TO_SPEND";
      }
    } else if (input.action === "REVISE") status = "REVISION_REQUESTED";
    else status = "REJECTED";

    const [updated] = await tx.update(purchaseRequests).set({ status, approvedFundAccountId }).where(eq(purchaseRequests.id, id)).returning();
    await tx.insert(purchaseRequestActions).values({ purchaseRequestId: id, actorUserId: actor.userId, action: input.action, reason: input.reason?.trim() });
    await audit(tx, actor, input.action, id, { status: current.status }, { status: updated.status, approvedFundAccountId }, input.reason?.trim());
    return updated;
  });
}

export async function setPurchaseFundingSource(actor: ActorContext, id: string, fundAccountCode: string) {
  assertPermission(actor, Permission.PURCHASE_APPROVE);
  return db.transaction(async (tx) => {
    const current = await requestById(tx, id);
    assertState(current.status, ["APPROVED"], "select funding source for");
    if (!["HOUSEBANK", "CASHIER_CASH"].includes(fundAccountCode)) throw appError("Purchase Request funding source must be HOUSEBANK or CASHIER_CASH", 422, "PURCHASE_FUND_SOURCE_INVALID");
    const [fund] = await tx.select({ id: fundAccounts.id, code: fundAccounts.code }).from(fundAccounts).where(and(eq(fundAccounts.code, fundAccountCode), eq(fundAccounts.isActive, true))).limit(1);
    if (!fund) throw appError("Funding source is not configured", 422, "FUND_ACCOUNT_NOT_CONFIGURED");
    const [updated] = await tx.update(purchaseRequests).set({ approvedFundAccountId: fund.id, status: "FUNDED_READY_TO_SPEND" }).where(eq(purchaseRequests.id, id)).returning();
    await audit(tx, actor, "FUND_SOURCE_SELECTED", id, { status: current.status, approvedFundAccountId: current.approvedFundAccountId }, { status: updated.status, approvedFundAccountId: fund.id, fundCode: fund.code });
    return updated;
  });
}

export async function recordPurchaseSpend(actor: ActorContext, id: string, input: { businessDate: string; amount: string; expenseCategoryCode: string; description: string; counterpartyName?: string; referenceNo?: string; receiptReference?: string }) {
  assertPermission(actor, Permission.PURCHASE_SPEND_RECORD);
  const amount = positive(input.amount, 2, "amount");
  return db.transaction(async (tx) => {
    const current = await requestById(tx, id);
    assertState(current.status, ["FUNDED_READY_TO_SPEND"], "record spend for");
    if (!current.approvedFundAccountId) throw appError("Purchase Request does not have an approved funding source", 409, "PURCHASE_FUNDING_REQUIRED");
    const [fund] = await tx.select({ id: fundAccounts.id, coaAccountId: fundAccounts.coaAccountId, code: fundAccounts.code }).from(fundAccounts).where(eq(fundAccounts.id, current.approvedFundAccountId)).limit(1);
    if (!fund) throw appError("Approved fund account no longer exists", 409, "PURCHASE_FUNDING_INVALID");
    const [category] = await tx.select({ id: expenseCategories.id, expenseAccountId: expenseCategories.expenseAccountId }).from(expenseCategories).where(and(eq(expenseCategories.code, input.expenseCategoryCode), eq(expenseCategories.isActive, true))).limit(1);
    if (!category) throw appError("Expense category is not configured", 422, "EXPENSE_CATEGORY_NOT_CONFIGURED");

    const [transaction] = await tx.insert(fundTransactions).values({
      sourceFundAccountId: fund.id,
      expenseCategoryId: category.id,
      purchaseRequestId: id,
      createdBy: actor.userId,
      transactionNo: makeNo("PREXP", input.businessDate),
      businessDate: input.businessDate,
      transactionType: "EXPENSE",
      amount,
      description: input.description.trim(),
      counterpartyName: input.counterpartyName?.trim(),
      referenceNo: input.referenceNo?.trim(),
      receiptReference: input.receiptReference?.trim(),
      status: "POSTED",
    }).returning({ id: fundTransactions.id, transactionNo: fundTransactions.transactionNo });

    const [journal] = await tx.insert(journalEntries).values({
      createdBy: actor.userId,
      entryNo: makeNo("JE", input.businessDate),
      businessDate: input.businessDate,
      sourceType: "FUND_TRANSACTION",
      sourceId: transaction.id,
      description: input.description.trim(),
      status: "POSTED",
    }).returning({ id: journalEntries.id });
    await tx.insert(journalLines).values([
      { journalEntryId: journal.id, accountId: category.expenseAccountId, debit: amount, credit: "0", memo: input.description.trim() },
      { journalEntryId: journal.id, accountId: fund.coaAccountId, debit: "0", credit: amount, memo: input.description.trim() },
    ]);

    const [updated] = await tx.update(purchaseRequests).set({ status: "PURCHASED" }).where(eq(purchaseRequests.id, id)).returning();
    await audit(tx, actor, "PURCHASE_SPEND_RECORDED", id, { status: current.status }, { status: updated.status, fundTransactionId: transaction.id, journalEntryId: journal.id, amount, fundCode: fund.code });
    return { request: updated, fundTransaction: transaction, journalEntryId: journal.id };
  });
}

export async function recordPurchaseReceipt(actor: ActorContext, id: string, input: { storageProvider: string; storageFileId: string; fileUrl: string; fundTransactionId?: string }) {
  assertPermission(actor, Permission.PURCHASE_RECEIPT_UPLOAD);
  return db.transaction(async (tx) => {
    const current = await requestById(tx, id);
    assertState(current.status, ["PURCHASED", "RECEIPT_RECORDED"], "record receipt for");
    if (input.fundTransactionId) {
      const [linked] = await tx.select({ id: fundTransactions.id }).from(fundTransactions).where(and(eq(fundTransactions.id, input.fundTransactionId), eq(fundTransactions.purchaseRequestId, id), eq(fundTransactions.status, "POSTED"))).limit(1);
      if (!linked) throw appError("Fund transaction does not belong to this Purchase Request", 422, "RECEIPT_TRANSACTION_MISMATCH");
    }
    const [receipt] = await tx.insert(purchaseReceipts).values({
      purchaseRequestId: id,
      fundTransactionId: input.fundTransactionId,
      uploadedBy: actor.userId,
      storageProvider: input.storageProvider,
      storageFileId: input.storageFileId,
      fileUrl: input.fileUrl,
    }).returning();
    const [updated] = await tx.update(purchaseRequests).set({ status: "RECEIPT_RECORDED" }).where(eq(purchaseRequests.id, id)).returning();
    await audit(tx, actor, "RECEIPT_RECORDED", id, { status: current.status }, { status: updated.status, receiptId: receipt.id });
    return { request: updated, receipt };
  });
}

export async function closePurchaseRequest(actor: ActorContext, id: string) {
  assertPermission(actor, Permission.PURCHASE_SPEND_RECORD);
  return db.transaction(async (tx) => {
    const current = await requestById(tx, id);
    assertState(current.status, ["PURCHASED", "RECEIPT_RECORDED"], "close");
    const [setting] = await tx.select({ valueJson: systemSettings.valueJson }).from(systemSettings).where(eq(systemSettings.settingKey, "purchase.receipt_required_to_close")).limit(1);
    const receiptRequired = setting?.valueJson === true || setting?.valueJson === "true";
    if (receiptRequired && current.status !== "RECEIPT_RECORDED") throw appError("Receipt is required before closing this Purchase Request", 409, "PURCHASE_RECEIPT_REQUIRED");
    const [updated] = await tx.update(purchaseRequests).set({ status: "CLOSED" }).where(eq(purchaseRequests.id, id)).returning();
    await tx.insert(purchaseRequestActions).values({ purchaseRequestId: id, actorUserId: actor.userId, action: "CLOSE" });
    await audit(tx, actor, "CLOSE", id, { status: current.status }, { status: updated.status });
    return updated;
  });
}

export async function listPurchaseRequests(actor: ActorContext) {
  assertPermission(actor, Permission.PURCHASE_VIEW);
  return db.select({
    id: purchaseRequests.id,
    requestNo: purchaseRequests.requestNo,
    requestDate: purchaseRequests.requestDate,
    purpose: purchaseRequests.purpose,
    estimatedTotal: purchaseRequests.estimatedTotal,
    status: purchaseRequests.status,
    requestedBy: purchaseRequests.requestedBy,
    approvedFundAccountId: purchaseRequests.approvedFundAccountId,
  }).from(purchaseRequests).orderBy(desc(purchaseRequests.requestDate), desc(purchaseRequests.requestNo));
}

export async function getPurchaseRequest(actor: ActorContext, id: string) {
  assertPermission(actor, Permission.PURCHASE_VIEW);
  const [request] = await db.select().from(purchaseRequests).where(eq(purchaseRequests.id, id)).limit(1);
  if (!request) throw appError("Purchase Request not found", 404, "PURCHASE_REQUEST_NOT_FOUND");
  const items = await db.select().from(purchaseRequestItems).where(eq(purchaseRequestItems.purchaseRequestId, id)).orderBy(asc(purchaseRequestItems.itemName));
  const actions = await db.select().from(purchaseRequestActions).where(eq(purchaseRequestActions.purchaseRequestId, id)).orderBy(asc(purchaseRequestActions.createdAt));
  const receipts = await db.select().from(purchaseReceipts).where(eq(purchaseReceipts.purchaseRequestId, id));
  const spends = await db.select().from(fundTransactions).where(and(eq(fundTransactions.purchaseRequestId, id), eq(fundTransactions.transactionType, "EXPENSE"))).orderBy(asc(fundTransactions.createdAt));
  return { request, items, actions, receipts, spends };
}
