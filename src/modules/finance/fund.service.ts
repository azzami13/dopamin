import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs, chartOfAccounts, expenseCategories, fundAccounts, fundTransactions, journalEntries, journalLines } from "@/db/schema";
import type { ActorContext } from "@/lib/auth/authorization";
import { assertPermission } from "@/lib/auth/authorization";
import { Permission } from "@/lib/auth/permissions";

function ensurePositive(amount: string): string {
  const d = new Decimal(amount);
  if (!d.isFinite() || d.lte(0)) throw Object.assign(new Error("Amount must be greater than zero"), { status: 422, code: "INVALID_AMOUNT" });
  return d.toFixed(2);
}
function no(prefix: string, businessDate: string) { return `${prefix}-${businessDate.replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`; }

async function fundByCode(tx: any, code: string) {
  const [row] = await tx.select({ id: fundAccounts.id, coaAccountId: fundAccounts.coaAccountId }).from(fundAccounts).where(and(eq(fundAccounts.code, code), eq(fundAccounts.isActive, true))).limit(1);
  if (!row) throw Object.assign(new Error(`Fund account ${code} is not configured`), { status: 422, code: "FUND_ACCOUNT_NOT_CONFIGURED" });
  return row;
}
async function coaByCode(tx: any, code: string) {
  const [row] = await tx.select({ id: chartOfAccounts.id }).from(chartOfAccounts).where(eq(chartOfAccounts.code, code)).limit(1);
  if (!row) throw Object.assign(new Error(`COA ${code} is not configured`), { status: 422, code: "COA_NOT_CONFIGURED" });
  return row;
}
async function postTwoLineJournal(tx: any, input: { actor: ActorContext; sourceId: string; businessDate: string; description: string; debitAccountId: string; creditAccountId: string; amount: string }) {
  const [entry] = await tx.insert(journalEntries).values({ createdBy: input.actor.userId, entryNo: no("JE", input.businessDate), businessDate: input.businessDate, sourceType: "FUND_TRANSACTION", sourceId: input.sourceId, description: input.description, status: "POSTED" }).returning({ id: journalEntries.id });
  await tx.insert(journalLines).values([
    { journalEntryId: entry.id, accountId: input.debitAccountId, debit: input.amount, credit: "0", memo: input.description },
    { journalEntryId: entry.id, accountId: input.creditAccountId, debit: "0", credit: input.amount, memo: input.description },
  ]);
  return entry.id;
}
async function audit(tx: any, actor: ActorContext, action: string, entityId: string, afterData: Record<string, unknown>, reason?: string) {
  await tx.insert(auditLogs).values({ actorUserId: actor.userId, actorRole: actor.role, action, module: "FINANCE", entityType: "fund_transaction", entityId, afterData, reason, source: "WEB" });
}

export async function createCompanyFunding(actor: ActorContext, input: { businessDate: string; amount: string; description: string; referenceNo?: string }) {
  assertPermission(actor, Permission.FINANCE_COMPANY_FUNDING);
  const amount = ensurePositive(input.amount);
  return db.transaction(async (tx) => {
    const housebank = await fundByCode(tx, "HOUSEBANK");
    const fundingCoa = await coaByCode(tx, "3001");
    const [transaction] = await tx.insert(fundTransactions).values({ destinationFundAccountId: housebank.id, createdBy: actor.userId, transactionNo: no("FUND", input.businessDate), businessDate: input.businessDate, transactionType: "EXTERNAL_FUNDING", amount, description: input.description, referenceNo: input.referenceNo, status: "POSTED" }).returning({ id: fundTransactions.id, transactionNo: fundTransactions.transactionNo });
    const journalEntryId = await postTwoLineJournal(tx, { actor, sourceId: transaction.id, businessDate: input.businessDate, description: input.description, debitAccountId: housebank.coaAccountId, creditAccountId: fundingCoa.id, amount });
    await audit(tx, actor, "COMPANY_FUNDING", transaction.id, { ...input, amount, transactionNo: transaction.transactionNo, journalEntryId });
    return { ...transaction, journalEntryId };
  });
}

export async function createInternalTransfer(actor: ActorContext, input: { businessDate: string; amount: string; sourceCode: string; destinationCode: string; description: string }) {
  assertPermission(actor, Permission.FINANCE_TRANSFER);
  const amount = ensurePositive(input.amount);
  if (input.sourceCode === input.destinationCode) throw Object.assign(new Error("Source and destination must differ"), { status: 422, code: "SAME_FUND_ACCOUNT" });
  return db.transaction(async (tx) => {
    const source = await fundByCode(tx, input.sourceCode);
    const destination = await fundByCode(tx, input.destinationCode);
    const [transaction] = await tx.insert(fundTransactions).values({ sourceFundAccountId: source.id, destinationFundAccountId: destination.id, createdBy: actor.userId, transactionNo: no("TRF", input.businessDate), businessDate: input.businessDate, transactionType: "INTERNAL_TRANSFER", amount, description: input.description, status: "POSTED" }).returning({ id: fundTransactions.id, transactionNo: fundTransactions.transactionNo });
    const journalEntryId = await postTwoLineJournal(tx, { actor, sourceId: transaction.id, businessDate: input.businessDate, description: input.description, debitAccountId: destination.coaAccountId, creditAccountId: source.coaAccountId, amount });
    await audit(tx, actor, "FUND_TRANSFER", transaction.id, { ...input, amount, transactionNo: transaction.transactionNo, journalEntryId });
    return { ...transaction, journalEntryId };
  });
}

export async function createOperationalExpense(actor: ActorContext, input: { businessDate: string; amount: string; sourceCode: string; expenseCategoryCode: string; description: string; counterpartyName?: string; receiptReference?: string; referenceNo?: string }) {
  assertPermission(actor, Permission.FINANCE_EXPENSE);
  const amount = ensurePositive(input.amount);
  return db.transaction(async (tx) => {
    const source = await fundByCode(tx, input.sourceCode);
    const [category] = await tx.select({ id: expenseCategories.id, expenseAccountId: expenseCategories.expenseAccountId }).from(expenseCategories).where(and(eq(expenseCategories.code, input.expenseCategoryCode), eq(expenseCategories.isActive, true))).limit(1);
    if (!category) throw Object.assign(new Error("Expense category is not configured"), { status: 422, code: "EXPENSE_CATEGORY_NOT_CONFIGURED" });
    const [transaction] = await tx.insert(fundTransactions).values({ sourceFundAccountId: source.id, expenseCategoryId: category.id, createdBy: actor.userId, transactionNo: no("EXP", input.businessDate), businessDate: input.businessDate, transactionType: "EXPENSE", amount, description: input.description, counterpartyName: input.counterpartyName, receiptReference: input.receiptReference, referenceNo: input.referenceNo, status: "POSTED" }).returning({ id: fundTransactions.id, transactionNo: fundTransactions.transactionNo });
    const journalEntryId = await postTwoLineJournal(tx, { actor, sourceId: transaction.id, businessDate: input.businessDate, description: input.description, debitAccountId: category.expenseAccountId, creditAccountId: source.coaAccountId, amount });
    await audit(tx, actor, "OPERATIONAL_EXPENSE", transaction.id, { ...input, amount, transactionNo: transaction.transactionNo, journalEntryId });
    return { ...transaction, journalEntryId };
  });
}
