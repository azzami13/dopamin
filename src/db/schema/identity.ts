import { boolean, check, pgTable, primaryKey, timestamp, unique, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { id } from "./common";

export const roles = pgTable("roles", {
  id: id(),
  code: varchar("code", { length: 32 }).notNull().unique(),
  name: varchar("name", { length: 80 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
});

export const permissions = pgTable("permissions", {
  id: id(),
  code: varchar("code", { length: 80 }).notNull().unique(),
  name: varchar("name", { length: 160 }).notNull(),
});

export const rolePermissions = pgTable("role_permissions", {
  roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "restrict" }),
  permissionId: uuid("permission_id").notNull().references(() => permissions.id, { onDelete: "restrict" }),
}, (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })]);

export const users = pgTable("users", {
  id: id(),
  roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "restrict" }),
  email: varchar("email", { length: 320 }).notNull(),
  fullName: varchar("full_name", { length: 160 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
}, (t) => [unique("users_email_uq").on(t.email)]);


export const userSourceAliases = pgTable("user_source_aliases", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  sourceCode: varchar("source_code", { length: 24 }).notNull(),
  alias: varchar("alias", { length: 160 }).notNull(),
  normalizedAlias: varchar("normalized_alias", { length: 160 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("user_source_aliases_source_normalized_uq").on(t.sourceCode, t.normalizedAlias),
  check("user_source_aliases_source_ck", sql`${t.sourceCode} in ('CASHIER','KITCHEN','BEVERAGE')`),
]);
