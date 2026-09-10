import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs, roles, users } from "@/db/schema";
import { acceptableLoginPassword, failedAttempt, hashPassword, validPassword, verifyPassword } from "./password";

const fields = {
  id: users.id, email: users.email, name: users.fullName,
  active: users.isActive, roleActive: roles.isActive,
  passwordHash: users.passwordHash, passwordUpdatedAt: users.passwordUpdatedAt,
  failedLoginAttempts: users.failedLoginAttempts, lockedUntil: users.lockedUntil,
};

export async function authenticatePassword(email: unknown, password: unknown) {
  if (typeof email !== "string" || email.length > 320 || !acceptableLoginPassword(password)) return null;
  try {
    return await db.transaction(async (tx) => {
      const [user] = await tx.select(fields).from(users).innerJoin(roles, eq(roles.id, users.roleId))
        .where(sql`lower(trim(${users.email})) = ${email.trim().toLowerCase()}`).limit(1).for("update", { of: users });
      const now = new Date();
      if (!user || !user.active || !user.roleActive || !user.passwordHash || (user.lockedUntil && user.lockedUntil > now)) {
        await verifyPassword(password, null);
        return null;
      }
      if (!await verifyPassword(password, user.passwordHash)) {
        await tx.update(users).set(failedAttempt(user, now)).where(eq(users.id, user.id));
        return null; // Commit failed-attempt state, including the fifth-attempt lock.
      }
      await tx.update(users).set({ failedLoginAttempts: 0, lockedUntil: null }).where(eq(users.id, user.id));
      return { id: user.id, email: user.email, name: user.name, credentialVersion: user.passwordUpdatedAt?.toISOString() ?? null };
    });
  } catch {
    // Never let ORM errors (which can contain query parameters) reach Auth.js logs.
    return null;
  }
}

export async function credentialSessionIsCurrent(email: string, version: unknown): Promise<boolean> {
  const [user] = await db.select({ updatedAt: users.passwordUpdatedAt, active: users.isActive, roleActive: roles.isActive })
    .from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(sql`lower(trim(${users.email})) = ${email.trim().toLowerCase()}`).limit(1);
  return Boolean(user?.active && user.roleActive && typeof version === "string" && user.updatedAt?.toISOString() === version);
}

export async function changePassword(userId: string, currentPassword: unknown, newPassword: unknown): Promise<"OK" | "INVALID" | "POLICY" | "UNAVAILABLE"> {
  if (!validPassword(newPassword)) return "POLICY";
  if (!acceptableLoginPassword(currentPassword)) return "INVALID";
  try {
    const nextHash = await hashPassword(newPassword);
    return await db.transaction(async (tx) => {
      const [user] = await tx.select(fields).from(users).innerJoin(roles, eq(roles.id, users.roleId))
        .where(eq(users.id, userId)).limit(1).for("update", { of: users });
      const now = new Date();
      if (!user || !user.active || !user.roleActive || !user.passwordHash || (user.lockedUntil && user.lockedUntil > now)) return "INVALID";
      if (!await verifyPassword(currentPassword, user.passwordHash)) {
        await tx.update(users).set(failedAttempt(user, now)).where(eq(users.id, userId));
        return "INVALID";
      }
      if (await verifyPassword(newPassword, user.passwordHash)) return "POLICY";
      await tx.update(users).set({ passwordHash: nextHash, mustChangePassword: false, failedLoginAttempts: 0, lockedUntil: null,
        passwordUpdatedAt: sql`greatest(clock_timestamp(), coalesce(${users.passwordUpdatedAt}, '-infinity'::timestamptz) + interval '1 millisecond')` }).where(eq(users.id, userId));
      await tx.insert(auditLogs).values({ actorUserId: userId, action: "PASSWORD_CHANGED", module: "AUTH", entityType: "user", entityId: userId, source: "WEB" });
      return "OK";
    });
  } catch { return "UNAVAILABLE"; }
}
