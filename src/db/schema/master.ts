import { sql } from "drizzle-orm";
import { AnyPgColumn, boolean, check, date, index, pgTable, text, uuid, varchar } from "drizzle-orm/pg-core";
import { id, money } from "./common";
import { users } from "./identity";

export const chartOfAccounts = pgTable("chart_of_accounts", {
  id: id(),
  parentId: uuid("parent_id").references((): AnyPgColumn => chartOfAccounts.id, { onDelete: "restrict" }),
  code: varchar("code", { length: 40 }).notNull().unique(),
  name: varchar("name", { length: 160 }).notNull(),
  accountType: varchar("account_type", { length: 24 }).notNull(),
  accountSubtype: varchar("account_subtype", { length: 40 }),
  description: text("description"),
}, (t) => [
  check("chart_of_accounts_type_ck", sql`${t.accountType} in ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')`),
]);

export const paymentMethods = pgTable("payment_methods", {
  id: id(),
  settlementAccountId: uuid("settlement_account_id").notNull().references(() => chartOfAccounts.id, { onDelete: "restrict" }),
  code: varchar("code", { length: 60 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
});

export const expenseCategories = pgTable("expense_categories", {
  id: id(),
  expenseAccountId: uuid("expense_account_id").notNull().references(() => chartOfAccounts.id, { onDelete: "restrict" }),
  code: varchar("code", { length: 60 }).notNull().unique(),
  name: varchar("name", { length: 160 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
});

export const menuItems = pgTable("menu_items", {
  id: id(),
  revenueAccountId: uuid("revenue_account_id").notNull().references(() => chartOfAccounts.id, { onDelete: "restrict" }),
  code: varchar("code", { length: 80 }).notNull().unique(),
  name: varchar("name", { length: 160 }).notNull(),
  category: varchar("category", { length: 16 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
}, (t) => [check("menu_items_category_ck", sql`${t.category} in ('FOOD','BEVERAGE')`)]);

export const menuPriceHistory = pgTable("menu_price_history", {
  id: id(),
  menuItemId: uuid("menu_item_id").notNull().references(() => menuItems.id, { onDelete: "restrict" }),
  createdBy: uuid("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  price: money("price").notNull(),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  effectiveTo: date("effective_to", { mode: "string" }),
}, (t) => [
  index("menu_price_history_lookup_idx").on(t.menuItemId, t.effectiveFrom),
  check("menu_price_history_price_ck", sql`${t.price} >= 0`),
  check("menu_price_history_range_ck", sql`${t.effectiveTo} is null or ${t.effectiveTo} >= ${t.effectiveFrom}`),
]);

export const fundAccounts = pgTable("fund_accounts", {
  id: id(),
  coaAccountId: uuid("coa_account_id").notNull().references(() => chartOfAccounts.id, { onDelete: "restrict" }),
  code: varchar("code", { length: 60 }).notNull().unique(),
  name: varchar("name", { length: 160 }).notNull(),
  accountType: varchar("account_type", { length: 40 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
});
