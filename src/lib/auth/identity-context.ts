import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { permissions, rolePermissions, roles, users } from "@/db/schema";
import type { RoleCode } from "./permissions";

export type ActorContext = {
  userId: string;
  email: string;
  fullName: string;
  role: RoleCode;
  permissions: string[];
  source: "WEB";
  mustChangePassword?: boolean;
};

export async function findActiveActorByEmail(email: string): Promise<ActorContext | null> {
  const [identity] = await db
    .select({
      userId: users.id,
      roleId: users.roleId,
      email: users.email,
      fullName: users.fullName,
      role: roles.code,
      isActive: users.isActive,
      roleActive: roles.isActive,
      mustChangePassword: users.mustChangePassword,
    })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(sql`lower(trim(${users.email})) = ${email.trim().toLowerCase()}`)
    .limit(1);

  if (!identity || !identity.isActive || !identity.roleActive) return null;

  const permissionRows = await db
    .select({ code: permissions.code })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(rolePermissions.roleId, identity.roleId));

  return {
    userId: identity.userId,
    email: identity.email,
    fullName: identity.fullName,
    role: identity.role as RoleCode,
    permissions: permissionRows.map((row) => row.code),
    source: "WEB",
    mustChangePassword: identity.mustChangePassword,
  };
}
