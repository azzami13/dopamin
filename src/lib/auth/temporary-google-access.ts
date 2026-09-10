import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs, roles, users } from "@/db/schema";

// Invoke only after Google OAuth has verified the email identity.
export async function provisionTemporaryGoogleOwner(emailInput: string, name?: string | null) {
  if (process.env.GOOGLE_TEMPORARY_OWNER_ACCESS !== "true") return false;
  const email = emailInput.trim().toLowerCase();
  if (!email || email.length > 320) throw new Error("Invalid Google identity");
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${email}, 4004))`);
    const [existing] = await tx.select({ id: users.id }).from(users).where(sql`lower(trim(${users.email})) = ${email}`).limit(1);
    if (existing) return false;
    const [role] = await tx.select({ id: roles.id }).from(roles).where(and(eq(roles.code, "OWNER"), eq(roles.isActive, true))).for("share");
    if (!role) throw new Error("Active OWNER role required");
    const [created] = await tx.insert(users).values({ email, fullName: (name?.trim() || email).slice(0, 160), roleId: role.id })
      .onConflictDoNothing().returning({ id: users.id });
    if (!created) return false;
    await tx.insert(auditLogs).values({ action: "GOOGLE_OWNER_AUTO_GRANTED", module: "AUTH", entityType: "user", entityId: created.id,
      source: "SYSTEM", afterData: { role: "OWNER", mode: "temporary_google_access" } });
    return true;
  });
}
