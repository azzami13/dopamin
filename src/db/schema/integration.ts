import { sql } from "drizzle-orm";
import { AnyPgColumn, boolean, check, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { id } from "./common";
import { users } from "./identity";

export const dataSources = pgTable("data_sources", {
  id: id(),
  code: varchar("code", { length: 40 }).notNull().unique(),
  sourceType: varchar("source_type", { length: 24 }).notNull(),
  spreadsheetId: varchar("spreadsheet_id", { length: 255 }),
  sheetName: varchar("sheet_name", { length: 255 }),
  isRequiredDaily: boolean("is_required_daily").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
}, (t) => [check("data_sources_source_type_ck", sql`${t.sourceType} in ('FORM','SHEET_IMPORT')`)]);

export const sourceFieldMappings = pgTable("source_field_mappings", {
  id: id(),
  dataSourceId: uuid("data_source_id").notNull().references(() => dataSources.id, { onDelete: "restrict" }),
  sourceFieldName: varchar("source_field_name", { length: 255 }).notNull(),
  mappingType: varchar("mapping_type", { length: 60 }).notNull(),
  targetKey: varchar("target_key", { length: 160 }).notNull(),
  mappingVersion: integer("mapping_version").notNull().default(1),
  isActive: boolean("is_active").notNull().default(true),
}, (t) => [
  uniqueIndex("source_field_mappings_uq").on(t.dataSourceId, t.sourceFieldName, t.mappingVersion),
]);

export const rawSubmissions = pgTable("raw_submissions", {
  id: id(),
  dataSourceId: uuid("data_source_id").notNull().references(() => dataSources.id, { onDelete: "restrict" }),
  sourceRecordKey: varchar("source_record_key", { length: 255 }).notNull(),
  sourceRevision: integer("source_revision").notNull().default(1),
  supersedesSubmissionId: uuid("supersedes_submission_id").references((): AnyPgColumn => rawSubmissions.id, { onDelete: "restrict" }),
  submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "date" }).notNull(),
  businessDateDetected: date("business_date_detected", { mode: "string" }),
  payloadHash: varchar("payload_hash", { length: 128 }).notNull(),
  rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>().notNull(),
  processingStatus: varchar("processing_status", { length: 32 }).notNull().default("RECEIVED"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("raw_submissions_source_revision_uq").on(t.dataSourceId, t.sourceRecordKey, t.sourceRevision),
  uniqueIndex("raw_submissions_payload_uq").on(t.dataSourceId, t.sourceRecordKey, t.payloadHash),
  index("raw_submissions_processing_idx").on(t.processingStatus, t.firstSeenAt),
  check("raw_submissions_revision_ck", sql`${t.sourceRevision} >= 1`),
  check("raw_submissions_status_ck", sql`${t.processingStatus} in ('RECEIVED','PROCESSING','VALID','NEEDS_REVIEW','ERROR','SUPERSEDED')`),
]);

export const syncRuns = pgTable("sync_runs", {
  id: id(),
  dataSourceId: uuid("data_source_id").notNull().references(() => dataSources.id, { onDelete: "restrict" }),
  triggerType: varchar("trigger_type", { length: 32 }).notNull(),
  status: varchar("status", { length: 24 }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
}, (t) => [
  check("sync_runs_trigger_ck", sql`${t.triggerType} in ('WEBHOOK','REPLAY','RECONCILIATION','MANUAL')`),
  check("sync_runs_status_ck", sql`${t.status} in ('RUNNING','SUCCESS','PARTIAL','FAILED')`),
]);

export const dataIssues = pgTable("data_issues", {
  id: id(),
  sourceSubmissionId: uuid("source_submission_id").references(() => rawSubmissions.id, { onDelete: "restrict" }),
  module: varchar("module", { length: 40 }).notNull(),
  severity: varchar("severity", { length: 16 }).notNull(),
  issueCode: varchar("issue_code", { length: 80 }).notNull(),
  fieldName: varchar("field_name", { length: 255 }),
  message: text("message").notNull(),
  status: varchar("status", { length: 16 }).notNull().default("OPEN"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
  resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "restrict" }),
}, (t) => [
  index("data_issues_status_idx").on(t.status, t.severity, t.createdAt),
  check("data_issues_severity_ck", sql`${t.severity} in ('INFO','WARNING','CRITICAL')`),
  check("data_issues_status_ck", sql`${t.status} in ('OPEN','RESOLVED','IGNORED')`),
]);
