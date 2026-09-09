import { sql } from "drizzle-orm";
import { check, date, index, integer, pgTable, text, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { id, money, quantity } from "./common";
import { rawSubmissions } from "./integration";
import { users } from "./identity";
import { expenseCategories, menuItems, menuPriceHistory, paymentMethods } from "./master";

export const cashierReports = pgTable("cashier_reports", {
  id: id(),
  sourceSubmissionId: uuid("source_submission_id").notNull().references(() => rawSubmissions.id, { onDelete: "restrict" }).unique(),
  cashierUserId: uuid("cashier_user_id").references(() => users.id, { onDelete: "restrict" }),
  businessDate: date("business_date", { mode: "string" }).notNull(),
  cashierNameRaw: varchar("cashier_name_raw", { length: 160 }),
  shiftCode: varchar("shift_code", { length: 40 }),
  transactionType: varchar("transaction_type", { length: 80 }),
  openingClosingStatus: varchar("opening_closing_status", { length: 80 }),
  pettyCashAmount: money("petty_cash_amount"),
  cashOutsidePettyAmount: money("cash_outside_petty_amount"),
  reportStatus: varchar("report_status", { length: 32 }).notNull().default("VALID"),
}, (t) => [
  index("cashier_reports_daily_idx").on(t.businessDate, t.shiftCode, t.reportStatus),
  check("cashier_reports_petty_ck", sql`${t.pettyCashAmount} is null or ${t.pettyCashAmount} >= 0`),
  check("cashier_reports_outside_petty_ck", sql`${t.cashOutsidePettyAmount} is null or ${t.cashOutsidePettyAmount} >= 0`),
]);

export const paymentLines = pgTable("payment_lines", {
  id: id(),
  cashierReportId: uuid("cashier_report_id").notNull().references(() => cashierReports.id, { onDelete: "restrict" }),
  paymentMethodId: uuid("payment_method_id").notNull().references(() => paymentMethods.id, { onDelete: "restrict" }),
  amount: money("amount").notNull(),
  sourceField: varchar("source_field", { length: 255 }).notNull(),
}, (t) => [
  index("payment_lines_method_idx").on(t.paymentMethodId, t.cashierReportId),
  check("payment_lines_amount_ck", sql`${t.amount} >= 0`),
]);

export const cashierExpenseLines = pgTable("cashier_expense_lines", {
  id: id(),
  cashierReportId: uuid("cashier_report_id").notNull().references(() => cashierReports.id, { onDelete: "restrict" }),
  expenseCategoryId: uuid("expense_category_id").references(() => expenseCategories.id, { onDelete: "restrict" }),
  amount: money("amount").notNull(),
  staffNameRaw: varchar("staff_name_raw", { length: 160 }),
  description: text("description"),
  sourceField: varchar("source_field", { length: 255 }),
}, (t) => [check("cashier_expense_lines_amount_ck", sql`${t.amount} >= 0`)]);

export const cashCounts = pgTable("cash_counts", {
  id: id(),
  cashierReportId: uuid("cashier_report_id").notNull().references(() => cashierReports.id, { onDelete: "restrict" }),
  denominationAmount: money("denomination_amount").notNull(),
  quantity: integer("quantity").notNull(),
  sourceField: varchar("source_field", { length: 255 }).notNull(),
}, (t) => [
  uniqueIndex("cash_counts_report_denom_uq").on(t.cashierReportId, t.denominationAmount),
  check("cash_counts_denom_ck", sql`${t.denominationAmount} > 0`),
  check("cash_counts_qty_ck", sql`${t.quantity} >= 0`),
]);

export const salesReports = pgTable("sales_reports", {
  id: id(),
  sourceSubmissionId: uuid("source_submission_id").notNull().references(() => rawSubmissions.id, { onDelete: "restrict" }).unique(),
  inputterUserId: uuid("inputter_user_id").references(() => users.id, { onDelete: "restrict" }),
  reportType: varchar("report_type", { length: 16 }).notNull(),
  businessDate: date("business_date", { mode: "string" }).notNull(),
  inputterNameRaw: varchar("inputter_name_raw", { length: 160 }),
  reportStatus: varchar("report_status", { length: 32 }).notNull().default("VALID"),
}, (t) => [
  index("sales_reports_daily_idx").on(t.businessDate, t.reportType, t.reportStatus),
  check("sales_reports_type_ck", sql`${t.reportType} in ('FOOD','BEVERAGE')`),
]);

export const salesReportItems = pgTable("sales_report_items", {
  id: id(),
  salesReportId: uuid("sales_report_id").notNull().references(() => salesReports.id, { onDelete: "restrict" }),
  menuItemId: uuid("menu_item_id").notNull().references(() => menuItems.id, { onDelete: "restrict" }),
  menuPriceHistoryId: uuid("menu_price_history_id").references(() => menuPriceHistory.id, { onDelete: "restrict" }),
  quantity: quantity("quantity").notNull(),
  unitPriceSnapshot: money("unit_price_snapshot").notNull(),
  sourceField: varchar("source_field", { length: 255 }).notNull(),
}, (t) => [
  uniqueIndex("sales_report_items_report_menu_uq").on(t.salesReportId, t.menuItemId),
  index("sales_report_items_menu_idx").on(t.menuItemId, t.salesReportId),
  check("sales_report_items_qty_ck", sql`${t.quantity} >= 0`),
  check("sales_report_items_price_ck", sql`${t.unitPriceSnapshot} >= 0`),
]);
