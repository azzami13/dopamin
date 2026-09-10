import { boolean, check, integer, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
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
  passwordHash: text("password_hash"),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  passwordUpdatedAt: timestamp("password_updated_at", { withTimezone: true, mode: "date" }),
  failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true, mode: "date" }),
}, (t) => [unique("users_email_uq").on(t.email), uniqueIndex("users_normalized_email_uq").on(sql`lower(trim(${t.email}))`), check("users_failed_login_attempts_ck", sql`${t.failedLoginAttempts} >= 0`)]);

export const accessRequests = pgTable("access_requests", {
  id: id(),
  email: varchar("email", { length: 320 }).notNull(),
  fullName: varchar("full_name", { length: 160 }).notNull(),
  provider: varchar("provider", { length: 24 }).notNull().default("GOOGLE"),
  status: varchar("status", { length: 16 }).notNull().default("PENDING"),
  requestedAt: timestamp("requested_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "date" }),
  reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  approvedRoleId: uuid("approved_role_id").references(() => roles.id, { onDelete: "restrict" }),
}, t => [
  uniqueIndex("access_requests_pending_email_uq").on(sql`lower(trim(${t.email}))`).where(sql`${t.status} = 'PENDING'`),
  check("access_requests_status_ck", sql`${t.status} in ('PENDING','APPROVED','REJECTED')`),
  check("access_requests_provider_ck", sql`${t.provider} = 'GOOGLE'`),
  check("access_requests_email_ck", sql`${t.email} = lower(trim(${t.email})) and length(${t.email}) > 0`),
  check("access_requests_review_ck", sql`(${t.status} = 'PENDING' and ${t.reviewedAt} is null and ${t.reviewedByUserId} is null and ${t.approvedRoleId} is null) or (${t.status} = 'APPROVED' and ${t.reviewedAt} is not null and ${t.reviewedByUserId} is not null and ${t.approvedRoleId} is not null) or (${t.status} = 'REJECTED' and ${t.reviewedAt} is not null and ${t.reviewedByUserId} is not null and ${t.approvedRoleId} is null)`),
]);


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
