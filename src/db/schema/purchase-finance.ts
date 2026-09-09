import { sql } from "drizzle-orm";
import { AnyPgColumn, check, date, index, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { id, money, quantity } from "./common";
import { users } from "./identity";
import { rawSubmissions } from "./integration";
import { chartOfAccounts, expenseCategories, fundAccounts } from "./master";

export const purchaseRequests = pgTable("purchase_requests", {
  id: id(),
  requestedBy: uuid("requested_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  approvedFundAccountId: uuid("approved_fund_account_id").references(() => fundAccounts.id, { onDelete: "restrict" }),
  requestNo: varchar("request_no", { length: 80 }).notNull().unique(),
  requestDate: date("request_date", { mode: "string" }).notNull(),
  purpose: text("purpose").notNull(),
  estimatedTotal: money("estimated_total").notNull(),
  status: varchar("status", { length: 40 }).notNull().default("DRAFT"),
}, (t) => [
  check("purchase_requests_estimate_ck", sql`${t.estimatedTotal} >= 0`),
  check("purchase_requests_status_ck", sql`${t.status} in ('DRAFT','SUBMITTED','APPROVED','FUNDED_READY_TO_SPEND','PURCHASED','RECEIPT_RECORDED','CLOSED','REVISION_REQUESTED','REJECTED')`),
]);

export const purchaseRequestItems = pgTable("purchase_request_items", {
  id: id(),
  purchaseRequestId: uuid("purchase_request_id").notNull().references(() => purchaseRequests.id, { onDelete: "restrict" }),
  itemName: varchar("item_name", { length: 200 }).notNull(),
  quantity: quantity("quantity").notNull(),
  unit: varchar("unit", { length: 40 }).notNull(),
  estimatedUnitCost: money("estimated_unit_cost").notNull(),
}, (t) => [
  check("purchase_request_items_qty_ck", sql`${t.quantity} > 0`),
  check("purchase_request_items_cost_ck", sql`${t.estimatedUnitCost} >= 0`),
]);

export const purchaseRequestActions = pgTable("purchase_request_actions", {
  id: id(),
  purchaseRequestId: uuid("purchase_request_id").notNull().references(() => purchaseRequests.id, { onDelete: "restrict" }),
  actorUserId: uuid("actor_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  action: varchar("action", { length: 32 }).notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (t) => [check("purchase_request_actions_action_ck", sql`${t.action} in ('SUBMIT','APPROVE','REVISE','REJECT','CLOSE')`)]);

export const fundTransactions = pgTable("fund_transactions", {
  id: id(),
  sourceFundAccountId: uuid("source_fund_account_id").references(() => fundAccounts.id, { onDelete: "restrict" }),
  destinationFundAccountId: uuid("destination_fund_account_id").references(() => fundAccounts.id, { onDelete: "restrict" }),
  expenseCategoryId: uuid("expense_category_id").references(() => expenseCategories.id, { onDelete: "restrict" }),
  purchaseRequestId: uuid("purchase_request_id").references(() => purchaseRequests.id, { onDelete: "restrict" }),
  sourceSubmissionId: uuid("source_submission_id").references(() => rawSubmissions.id, { onDelete: "restrict" }),
  createdBy: uuid("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  transactionNo: varchar("transaction_no", { length: 80 }).notNull().unique(),
  businessDate: date("business_date", { mode: "string" }).notNull(),
  transactionType: varchar("transaction_type", { length: 32 }).notNull(),
  amount: money("amount").notNull(),
  description: text("description"),
  counterpartyName: varchar("counterparty_name", { length: 160 }),
  referenceNo: varchar("reference_no", { length: 160 }),
  receiptReference: text("receipt_reference"),
  status: varchar("status", { length: 16 }).notNull().default("POSTED"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (t) => [
  index("fund_transactions_daily_idx").on(t.businessDate, t.status),
  index("fund_transactions_accounts_idx").on(t.sourceFundAccountId, t.destinationFundAccountId),
  check("fund_transactions_amount_ck", sql`${t.amount} > 0`),
  check("fund_transactions_status_ck", sql`${t.status} in ('POSTED','VOID')`),
  check("fund_transactions_type_ck", sql`${t.transactionType} in ('EXTERNAL_FUNDING','INTERNAL_TRANSFER','EXPENSE','OPENING_BALANCE','ADJUSTMENT')`),
  check("fund_transactions_direction_ck", sql`
    (${t.transactionType} = 'EXTERNAL_FUNDING' and ${t.sourceFundAccountId} is null and ${t.destinationFundAccountId} is not null and ${t.expenseCategoryId} is null)
    or (${t.transactionType} = 'INTERNAL_TRANSFER' and ${t.sourceFundAccountId} is not null and ${t.destinationFundAccountId} is not null and ${t.sourceFundAccountId} <> ${t.destinationFundAccountId} and ${t.expenseCategoryId} is null)
    or (${t.transactionType} = 'EXPENSE' and ${t.sourceFundAccountId} is not null and ${t.destinationFundAccountId} is null and ${t.expenseCategoryId} is not null)
    or (${t.transactionType} = 'OPENING_BALANCE' and ${t.sourceFundAccountId} is null and ${t.destinationFundAccountId} is not null)
    or (${t.transactionType} = 'ADJUSTMENT' and (${t.sourceFundAccountId} is not null or ${t.destinationFundAccountId} is not null))
  `),
]);

export const purchaseReceipts = pgTable("purchase_receipts", {
  id: id(),
  purchaseRequestId: uuid("purchase_request_id").notNull().references(() => purchaseRequests.id, { onDelete: "restrict" }),
  fundTransactionId: uuid("fund_transaction_id").references(() => fundTransactions.id, { onDelete: "restrict" }),
  uploadedBy: uuid("uploaded_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  storageProvider: varchar("storage_provider", { length: 60 }).notNull(),
  storageFileId: varchar("storage_file_id", { length: 255 }).notNull(),
  fileUrl: text("file_url").notNull(),
});

export const journalEntries = pgTable("journal_entries", {
  id: id(),
  createdBy: uuid("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  reversedEntryId: uuid("reversed_entry_id").references((): AnyPgColumn => journalEntries.id, { onDelete: "restrict" }),
  entryNo: varchar("entry_no", { length: 80 }).notNull().unique(),
  businessDate: date("business_date", { mode: "string" }).notNull(),
  sourceType: varchar("source_type", { length: 60 }).notNull(),
  sourceId: uuid("source_id").notNull(),
  description: text("description").notNull(),
  status: varchar("status", { length: 16 }).notNull().default("POSTED"),
}, (t) => [
  uniqueIndex("journal_entries_posted_source_uq").on(t.sourceType, t.sourceId).where(sql`${t.status} = 'POSTED'`),
  check("journal_entries_status_ck", sql`${t.status} in ('POSTED','VOID')`),
]);

export const journalLines = pgTable("journal_lines", {
  id: id(),
  journalEntryId: uuid("journal_entry_id").notNull().references(() => journalEntries.id, { onDelete: "restrict" }),
  accountId: uuid("account_id").notNull().references(() => chartOfAccounts.id, { onDelete: "restrict" }),
  debit: money("debit").notNull().default("0"),
  credit: money("credit").notNull().default("0"),
  memo: text("memo"),
}, (t) => [
  check("journal_lines_nonnegative_ck", sql`${t.debit} >= 0 and ${t.credit} >= 0`),
  check("journal_lines_side_ck", sql`(${t.debit} > 0 and ${t.credit} = 0) or (${t.credit} > 0 and ${t.debit} = 0)`),
]);
