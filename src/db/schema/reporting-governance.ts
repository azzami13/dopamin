import { sql } from "drizzle-orm";
import { AnyPgColumn, boolean, check, date, index, integer, jsonb, pgTable, text, time, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { id, money } from "./common";
import { users } from "./identity";

export const dailyClosings = pgTable("daily_closings", {
  id: id(),
  closedBy: uuid("closed_by").references(() => users.id, { onDelete: "restrict" }),
  businessDate: date("business_date", { mode: "string" }).notNull().unique(),
  status: varchar("status", { length: 20 }).notNull().default("OPEN"),
  cashierComplete: boolean("cashier_complete").notNull().default(false),
  kitchenComplete: boolean("kitchen_complete").notNull().default(false),
  beverageComplete: boolean("beverage_complete").notNull().default(false),
  paymentTotalSnapshot: money("payment_total_snapshot"),
  salesTotalSnapshot: money("sales_total_snapshot"),
  salesPaymentDifference: money("sales_payment_difference"),
  cashVarianceSnapshot: money("cash_variance_snapshot"),
}, (t) => [check("daily_closings_status_ck", sql`${t.status} in ('OPEN','INCOMPLETE','RECONCILED','CLOSED')`)]);

export const dailyReportSettings = pgTable("daily_report_settings", {
  id: id(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "restrict" }),
  enabled: boolean("enabled").notNull().default(false),
  sendTime: time("send_time").notNull(),
  timezone: varchar("timezone", { length: 64 }).notNull().default("Asia/Jakarta"),
  incompleteBehavior: varchar("incomplete_behavior", { length: 32 }).notNull().default("SEND_INCOMPLETE"),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (t) => [check("daily_report_settings_behavior_ck", sql`${t.incompleteBehavior} = 'SEND_INCOMPLETE'`)]);

export const dailyReportRecipients = pgTable("daily_report_recipients", {
  id: id(),
  settingsId: uuid("settings_id").notNull().references(() => dailyReportSettings.id, { onDelete: "restrict" }),
  email: varchar("email", { length: 320 }).notNull(),
  recipientName: varchar("recipient_name", { length: 160 }),
  isEnabled: boolean("is_enabled").notNull().default(true),
}, (t) => [uniqueIndex("daily_report_recipients_uq").on(t.settingsId, t.email)]);

export const dailyReportRuns = pgTable("daily_report_runs", {
  id: id(),
  dailyClosingId: uuid("daily_closing_id").references(() => dailyClosings.id, { onDelete: "restrict" }),
  parentRunId: uuid("parent_run_id").references((): AnyPgColumn => dailyReportRuns.id, { onDelete: "restrict" }),
  triggeredBy: uuid("triggered_by").references(() => users.id, { onDelete: "restrict" }),
  businessDate: date("business_date", { mode: "string" }).notNull(),
  revisionNo: integer("revision_no").notNull().default(0),
  triggerType: varchar("trigger_type", { length: 16 }).notNull(),
  completenessStatus: varchar("completeness_status", { length: 16 }).notNull(),
  metricsSnapshot: jsonb("metrics_snapshot").$type<Record<string, unknown>>().notNull(),
  missingSources: jsonb("missing_sources").$type<unknown[]>().notNull(),
  status: varchar("status", { length: 24 }).notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("daily_report_runs_business_revision_uq").on(t.businessDate, t.revisionNo),
  check("daily_report_runs_revision_ck", sql`${t.revisionNo} >= 0`),
  check("daily_report_runs_trigger_ck", sql`${t.triggerType} in ('SCHEDULED','MANUAL','REVISION')`),
  check("daily_report_runs_complete_ck", sql`${t.completenessStatus} in ('COMPLETE','INCOMPLETE')`),
]);

export const dailyReportDeliveries = pgTable("daily_report_deliveries", {
  id: id(),
  reportRunId: uuid("report_run_id").notNull().references(() => dailyReportRuns.id, { onDelete: "restrict" }),
  recipientEmail: varchar("recipient_email", { length: 320 }).notNull(),
  deliveryStatus: varchar("delivery_status", { length: 24 }).notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }),
  errorMessage: text("error_message"),
}, (t) => [check("daily_report_deliveries_status_ck", sql`${t.deliveryStatus} in ('PENDING','SENT','FAILED','UNKNOWN')`)]);

export const dataCorrections = pgTable("data_corrections", {
  id: id(),
  createdBy: uuid("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  entityType: varchar("entity_type", { length: 80 }).notNull(),
  entityId: uuid("entity_id").notNull(),
  reason: text("reason").notNull(),
  status: varchar("status", { length: 16 }).notNull().default("ACTIVE"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (t) => [check("data_corrections_status_ck", sql`${t.status} in ('ACTIVE','SUPERSEDED')`)]);

export const dataCorrectionItems = pgTable("data_correction_items", {
  id: id(),
  correctionId: uuid("correction_id").notNull().references(() => dataCorrections.id, { onDelete: "restrict" }),
  fieldName: varchar("field_name", { length: 160 }).notNull(),
  oldValue: jsonb("old_value").$type<unknown>().notNull(),
  newValue: jsonb("new_value").$type<unknown>().notNull(),
});

export const auditLogs = pgTable("audit_logs", {
  id: id(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "restrict" }),
  actorRole: varchar("actor_role", { length: 40 }),
  action: varchar("action", { length: 64 }).notNull(),
  module: varchar("module", { length: 40 }).notNull(),
  entityType: varchar("entity_type", { length: 80 }).notNull(),
  entityId: uuid("entity_id"),
  beforeData: jsonb("before_data").$type<Record<string, unknown>>(),
  afterData: jsonb("after_data").$type<Record<string, unknown>>(),
  reason: text("reason"),
  source: varchar("source", { length: 24 }).notNull(),
  correlationId: varchar("correlation_id", { length: 100 }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (t) => [
  index("audit_logs_created_idx").on(t.createdAt),
  index("audit_logs_entity_idx").on(t.entityType, t.entityId),
  index("audit_logs_actor_idx").on(t.actorUserId, t.createdAt),
  check("audit_logs_source_ck", sql`${t.source} in ('WEB','GOOGLE_SCRIPT','SYSTEM')`),
]);

export const systemSettings = pgTable("system_settings", {
  id: id(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "restrict" }),
  settingKey: varchar("setting_key", { length: 120 }).notNull().unique(),
  valueJson: jsonb("value_json").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});
