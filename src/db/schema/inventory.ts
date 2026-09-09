import { sql } from "drizzle-orm";
import { boolean, check, date, index, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { id, quantity } from "./common";
import { users } from "./identity";

export const inventoryItems = pgTable("inventory_items", {
  id: id(),
  sku: varchar("sku", { length: 80 }).unique(),
  name: varchar("name", { length: 160 }).notNull(),
  category: varchar("category", { length: 16 }).notNull(),
  unit: varchar("unit", { length: 40 }).notNull(),
  minimumStock: quantity("minimum_stock"),
  isActive: boolean("is_active").notNull().default(true),
}, (t) => [
  check("inventory_items_category_ck", sql`${t.category} in ('KITCHEN','BAR','OTHER')`),
  check("inventory_items_min_ck", sql`${t.minimumStock} is null or ${t.minimumStock} >= 0`),
]);

export const stockOpnameSessions = pgTable("stock_opname_sessions", {
  id: id(),
  responsibleUserId: uuid("responsible_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "restrict" }),
  businessDate: date("business_date", { mode: "string" }).notNull(),
  category: varchar("category", { length: 16 }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("DRAFT"),
  submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "date" }),
}, (t) => [
  index("stock_opname_sessions_daily_idx").on(t.businessDate, t.category, t.status),
  check("stock_opname_sessions_category_ck", sql`${t.category} in ('KITCHEN','BAR','OTHER')`),
  check("stock_opname_sessions_status_ck", sql`${t.status} in ('DRAFT','SUBMITTED','REVIEWED')`),
]);

export const stockOpnameLines = pgTable("stock_opname_lines", {
  id: id(),
  sessionId: uuid("session_id").notNull().references(() => stockOpnameSessions.id, { onDelete: "restrict" }),
  inventoryItemId: uuid("inventory_item_id").notNull().references(() => inventoryItems.id, { onDelete: "restrict" }),
  referenceQty: quantity("reference_qty"),
  actualQty: quantity("actual_qty").notNull(),
  note: text("note"),
}, (t) => [
  uniqueIndex("stock_opname_lines_session_item_uq").on(t.sessionId, t.inventoryItemId),
  check("stock_opname_lines_ref_ck", sql`${t.referenceQty} is null or ${t.referenceQty} >= 0`),
  check("stock_opname_lines_actual_ck", sql`${t.actualQty} >= 0`),
]);
