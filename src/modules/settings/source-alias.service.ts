import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { roles, userSourceAliases, users } from "@/db/schema";
import { assertPermission, type ActorContext } from "@/lib/auth/authorization";
import { Permission } from "@/lib/auth/permissions";
import { appError } from "@/lib/http/api";
import { writeAudit } from "@/modules/audit/audit.service";

export type SourceAliasCode = "CASHIER" | "KITCHEN" | "BEVERAGE";

function normalizeAlias(alias: string) {
  return alias.trim().replace(/\s+/g, " ").toLowerCase();
}

export async function listSourceAliases(actor: ActorContext) {
  assertPermission(actor, Permission.USER_MANAGE);
  const aliases = await db.select({
    id: userSourceAliases.id,
    userId: userSourceAliases.userId,
    userName: users.fullName,
    userEmail: users.email,
    role: roles.code,
    sourceCode: userSourceAliases.sourceCode,
    alias: userSourceAliases.alias,
    normalizedAlias: userSourceAliases.normalizedAlias,
    isActive: userSourceAliases.isActive,
  }).from(userSourceAliases)
    .innerJoin(users, eq(users.id, userSourceAliases.userId))
    .innerJoin(roles, eq(roles.id, users.roleId))
    .orderBy(asc(userSourceAliases.sourceCode), asc(userSourceAliases.alias));

  const userRows = await db.select({
    id: users.id,
    fullName: users.fullName,
    email: users.email,
    role: roles.code,
    isActive: users.isActive,
  }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).orderBy(asc(users.fullName));

  return { aliases, users: userRows };
}

export async function upsertSourceAlias(actor: ActorContext, input: { userId: string; sourceCode: SourceAliasCode; alias: string; isActive?: boolean }) {
  assertPermission(actor, Permission.USER_MANAGE);
  const alias = input.alias.trim().replace(/\s+/g, " ");
  const normalizedAlias = normalizeAlias(alias);
  if (!alias || !normalizedAlias) throw appError("Alias is required", 422, "ALIAS_REQUIRED");

  return db.transaction(async (tx) => {
    const [user] = await tx.select({ id: users.id, roleCode: roles.code, isActive: users.isActive })
      .from(users).innerJoin(roles, eq(roles.id, users.roleId))
      .where(eq(users.id, input.userId)).limit(1);
    if (!user || !user.isActive) throw appError("Active target user not found", 404, "USER_NOT_FOUND");

    const allowed = input.sourceCode === "KITCHEN"
      ? user.roleCode === "KITCHEN"
      : user.roleCode === "CASHIER" || user.roleCode === "MANAGER" || user.roleCode === "OWNER" || user.roleCode === "DIRECTOR";
    if (!allowed) throw appError(`Role ${user.roleCode} is not compatible with source ${input.sourceCode}`, 422, "SOURCE_ROLE_MISMATCH");

    const [existing] = await tx.select().from(userSourceAliases).where(and(
      eq(userSourceAliases.sourceCode, input.sourceCode),
      eq(userSourceAliases.normalizedAlias, normalizedAlias),
    )).limit(1);

    let row;
    if (existing) {
      [row] = await tx.update(userSourceAliases).set({
        userId: input.userId,
        alias,
        isActive: input.isActive ?? true,
      }).where(eq(userSourceAliases.id, existing.id)).returning();
    } else {
      [row] = await tx.insert(userSourceAliases).values({
        userId: input.userId,
        sourceCode: input.sourceCode,
        alias,
        normalizedAlias,
        isActive: input.isActive ?? true,
      }).returning();
    }

    await writeAudit(tx, actor, {
      action: existing ? "UPDATE" : "CREATE",
      module: "SETTINGS",
      entityType: "user_source_alias",
      entityId: row.id,
      beforeData: existing ?? null,
      afterData: row,
      reason: "Source identity alias configuration",
    });
    return row;
  });
}

export async function setSourceAliasActive(actor: ActorContext, id: string, isActive: boolean) {
  assertPermission(actor, Permission.USER_MANAGE);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(userSourceAliases).where(eq(userSourceAliases.id, id)).limit(1);
    if (!before) throw appError("Source alias not found", 404, "ALIAS_NOT_FOUND");
    const [after] = await tx.update(userSourceAliases).set({ isActive }).where(eq(userSourceAliases.id, id)).returning();
    await writeAudit(tx, actor, {
      action: "UPDATE",
      module: "SETTINGS",
      entityType: "user_source_alias",
      entityId: id,
      beforeData: before,
      afterData: after,
      reason: isActive ? "Activate source alias" : "Deactivate source alias",
    });
    return after;
  });
}
