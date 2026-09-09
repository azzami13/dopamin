import Decimal from "decimal.js";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs, inventoryItems, stockOpnameLines, stockOpnameSessions } from "@/db/schema";
import type { ActorContext } from "@/lib/auth/authorization";
import { assertPermission } from "@/lib/auth/authorization";
import { Permission } from "@/lib/auth/permissions";
import { appError } from "@/lib/http/api";

type InventoryCategory = "KITCHEN" | "BAR" | "OTHER";

type LineInput = { inventoryItemId: string; referenceQty?: string | null; actualQty: string; note?: string };

function viewCategories(actor: ActorContext): InventoryCategory[] {
  if (actor.role === "OWNER" || actor.role === "DIRECTOR" || actor.role === "MANAGER") return ["KITCHEN", "BAR", "OTHER"];
  if (actor.role === "CASHIER") return ["BAR"];
  return ["KITCHEN"];
}

function inputCategories(actor: ActorContext): InventoryCategory[] {
  if (actor.role === "OWNER" || actor.role === "DIRECTOR") return ["KITCHEN", "BAR", "OTHER"];
  if (actor.role === "MANAGER") return ["OTHER"];
  if (actor.role === "CASHIER") return ["BAR"];
  return ["KITCHEN"];
}

function assertCategory(actor: ActorContext, category: string, mode: "VIEW" | "INPUT") {
  const categories = mode === "VIEW" ? viewCategories(actor) : inputCategories(actor);
  if (!categories.includes(category as InventoryCategory)) throw appError(`Role ${actor.role} cannot ${mode.toLowerCase()} ${category} stock`, 403, "INVENTORY_SCOPE_DENIED");
}

function qty(value: string, field: string, nullable = false): string | null {
  if (nullable && value === "") return null;
  const d = new Decimal(value);
  if (!d.isFinite() || d.lt(0)) throw appError(`${field} must be zero or greater`, 422, "INVALID_QUANTITY");
  return d.toFixed(3);
}

async function sessionById(tx: any, id: string) {
  const [session] = await tx.select().from(stockOpnameSessions).where(eq(stockOpnameSessions.id, id)).limit(1);
  if (!session) throw appError("Stock opname session not found", 404, "STOCK_SESSION_NOT_FOUND");
  return session;
}

function assertOwnEditableSession(actor: ActorContext, session: { responsibleUserId: string; category: string; status: string }) {
  assertCategory(actor, session.category, "INPUT");
  if (!["OWNER", "DIRECTOR"].includes(actor.role) && session.responsibleUserId !== actor.userId) {
    throw appError("This stock opname session belongs to another responsible user", 403, "STOCK_SESSION_SCOPE_DENIED");
  }
  if (session.status !== "DRAFT") throw appError("Completed/submitted stock opname is read-only; use correction flow for later changes", 409, "STOCK_SESSION_READ_ONLY");
}

async function audit(tx: any, actor: ActorContext, action: string, sessionId: string, beforeData?: Record<string, unknown>, afterData?: Record<string, unknown>) {
  await tx.insert(auditLogs).values({ actorUserId: actor.userId, actorRole: actor.role, action, module: "INVENTORY", entityType: "stock_opname_session", entityId: sessionId, beforeData, afterData, source: "WEB" });
}

export async function listInventoryItems(actor: ActorContext, category?: string) {
  assertPermission(actor, Permission.INVENTORY_VIEW);
  if (category) assertCategory(actor, category, "VIEW");
  const categories = category ? [category as InventoryCategory] : viewCategories(actor);
  return db.select().from(inventoryItems).where(and(inArray(inventoryItems.category, categories), eq(inventoryItems.isActive, true))).orderBy(inventoryItems.category, inventoryItems.name);
}

export async function createStockOpnameSession(actor: ActorContext, input: { businessDate: string; category: InventoryCategory }) {
  assertPermission(actor, Permission.INVENTORY_INPUT);
  assertCategory(actor, input.category, "INPUT");
  return db.transaction(async (tx) => {
    const [session] = await tx.insert(stockOpnameSessions).values({ responsibleUserId: actor.userId, businessDate: input.businessDate, category: input.category, status: "DRAFT" }).returning();
    await audit(tx, actor, "CREATE", session.id, undefined, { businessDate: input.businessDate, category: input.category, status: "DRAFT" });
    return session;
  });
}

export async function listStockOpnameSessions(actor: ActorContext, input?: { businessDate?: string; category?: string }) {
  assertPermission(actor, Permission.INVENTORY_VIEW);
  if (input?.category) assertCategory(actor, input.category, "VIEW");
  const categories = input?.category ? [input.category as InventoryCategory] : viewCategories(actor);
  const predicates = [inArray(stockOpnameSessions.category, categories)];
  if (input?.businessDate) predicates.push(eq(stockOpnameSessions.businessDate, input.businessDate));
  return db.select().from(stockOpnameSessions).where(and(...predicates)).orderBy(desc(stockOpnameSessions.businessDate));
}

export async function getStockOpnameSession(actor: ActorContext, id: string) {
  assertPermission(actor, Permission.INVENTORY_VIEW);
  const [session] = await db.select().from(stockOpnameSessions).where(eq(stockOpnameSessions.id, id)).limit(1);
  if (!session) throw appError("Stock opname session not found", 404, "STOCK_SESSION_NOT_FOUND");
  assertCategory(actor, session.category, "VIEW");
  const lines = await db.select({
    id: stockOpnameLines.id,
    inventoryItemId: stockOpnameLines.inventoryItemId,
    itemName: inventoryItems.name,
    unit: inventoryItems.unit,
    referenceQty: stockOpnameLines.referenceQty,
    actualQty: stockOpnameLines.actualQty,
    note: stockOpnameLines.note,
  }).from(stockOpnameLines).innerJoin(inventoryItems, eq(stockOpnameLines.inventoryItemId, inventoryItems.id)).where(eq(stockOpnameLines.sessionId, id)).orderBy(inventoryItems.name);
  const activeItems = await db.select({ id: inventoryItems.id }).from(inventoryItems).where(and(eq(inventoryItems.category, session.category), eq(inventoryItems.isActive, true)));
  return {
    session,
    activeItemCount: activeItems.length,
    countedItemCount: lines.length,
    missingItemCount: Math.max(0, activeItems.length - lines.length),
    lines: lines.map((line) => ({ ...line, varianceQty: line.referenceQty === null ? null : new Decimal(line.actualQty).minus(line.referenceQty).toFixed(3) })),
  };
}

export async function saveStockOpnameLines(actor: ActorContext, id: string, lines: LineInput[]) {
  assertPermission(actor, Permission.INVENTORY_INPUT);
  if (!lines.length) throw appError("At least one stock line is required", 422, "STOCK_LINES_REQUIRED");
  await db.transaction(async (tx) => {
    const session = await sessionById(tx, id);
    assertOwnEditableSession(actor, session);
    for (const line of lines) {
      const [item] = await tx.select({ id: inventoryItems.id, category: inventoryItems.category, isActive: inventoryItems.isActive }).from(inventoryItems).where(eq(inventoryItems.id, line.inventoryItemId)).limit(1);
      if (!item || !item.isActive) throw appError("Inventory item not found or inactive", 422, "INVENTORY_ITEM_INVALID", { inventoryItemId: line.inventoryItemId });
      if (item.category !== session.category) throw appError("Inventory item category does not match stock session category", 422, "INVENTORY_CATEGORY_MISMATCH", { inventoryItemId: line.inventoryItemId });
      const actualQty = qty(line.actualQty, "actualQty")!;
      const referenceQty = line.referenceQty === null || line.referenceQty === undefined ? null : qty(line.referenceQty, "referenceQty", true);
      await tx.insert(stockOpnameLines).values({ sessionId: id, inventoryItemId: item.id, actualQty, referenceQty, note: line.note?.trim() || null })
        .onConflictDoUpdate({ target: [stockOpnameLines.sessionId, stockOpnameLines.inventoryItemId], set: { actualQty, referenceQty, note: line.note?.trim() || null } });
    }
    await audit(tx, actor, "UPDATE", id, undefined, { lineCount: lines.length });
  });
  return getStockOpnameSession(actor, id);
}

export async function submitStockOpname(actor: ActorContext, id: string) {
  assertPermission(actor, Permission.INVENTORY_INPUT);
  return db.transaction(async (tx) => {
    const session = await sessionById(tx, id);
    assertOwnEditableSession(actor, session);
    const existing = await tx.select({ id: stockOpnameLines.id }).from(stockOpnameLines).where(eq(stockOpnameLines.sessionId, id)).limit(1);
    if (!existing.length) throw appError("Cannot submit an empty stock opname session", 409, "STOCK_SESSION_EMPTY");
    const [updated] = await tx.update(stockOpnameSessions).set({ status: "SUBMITTED", submittedAt: new Date() }).where(eq(stockOpnameSessions.id, id)).returning();
    await audit(tx, actor, "STOCK_SUBMITTED", id, { status: session.status }, { status: updated.status, submittedAt: updated.submittedAt?.toISOString() });
    return updated;
  });
}

export async function reviewStockOpname(actor: ActorContext, id: string) {
  assertPermission(actor, Permission.STOCK_REVIEW);
  return db.transaction(async (tx) => {
    const session = await sessionById(tx, id);
    if (session.status !== "SUBMITTED") throw appError("Only submitted stock opname can be reviewed", 409, "INVALID_STOCK_STATE");
    const [updated] = await tx.update(stockOpnameSessions).set({ status: "REVIEWED", reviewedBy: actor.userId }).where(eq(stockOpnameSessions.id, id)).returning();
    await audit(tx, actor, "STOCK_REVIEWED", id, { status: session.status }, { status: updated.status, reviewedBy: actor.userId });
    return updated;
  });
}
