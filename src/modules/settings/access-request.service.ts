import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { accessRequests, auditLogs, roles, users } from "@/db/schema";
import type { ActorContext } from "@/lib/auth/identity-context";
import { appError } from "@/lib/http/api";

export function assertAccessReviewer(actor: ActorContext) {
  if (actor.mustChangePassword || !['OWNER', 'DIRECTOR'].includes(actor.role)) throw appError('Akses ditolak.', 403, 'FORBIDDEN');
}

// Only called with the identity from the completed, verified Google OAuth callback.
// This function never creates or reactivates an application user.
export async function requestGoogleAccess(emailInput: string, nameInput: string | null | undefined) {
  const email = emailInput.trim().toLowerCase();
  const fullName = (nameInput?.trim() || email).slice(0, 160);
  if (!email || email.length > 320) throw new Error('Invalid Google identity');
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${email}, 4004))`);
    const [existing] = await tx.select({ id: users.id }).from(users).where(sql`lower(trim(${users.email})) = ${email}`).limit(1);
    if (existing) return 'EXISTING' as const;
    const [pending] = await tx.select({ id: accessRequests.id }).from(accessRequests)
      .where(and(eq(accessRequests.email, email), eq(accessRequests.status, 'PENDING'))).limit(1).for('update');
    if (pending) {
      await tx.update(accessRequests).set({ fullName }).where(eq(accessRequests.id, pending.id));
    } else {
      const [created] = await tx.insert(accessRequests).values({ email, fullName }).returning({ id: accessRequests.id });
      await tx.insert(auditLogs).values({ action: 'ACCESS_REQUESTED', module: 'AUTH', entityType: 'access_request', entityId: created.id, source: 'SYSTEM' });
    }
    return 'PENDING' as const;
  });
}

export async function listAccessRequests(actor: ActorContext) {
  assertAccessReviewer(actor);
  const requests = await db.select().from(accessRequests).where(eq(accessRequests.status, 'PENDING')).orderBy(asc(accessRequests.requestedAt));
  const roleOptions = await db.select({ id: roles.id, code: roles.code, name: roles.name }).from(roles).where(eq(roles.isActive, true)).orderBy(asc(roles.code));
  return { requests, roles: roleOptions };
}

export async function reviewAccessRequest(actor: ActorContext, input: { id: string; decision: 'APPROVED' | 'REJECTED'; roleId?: string }) {
  assertAccessReviewer(actor);
  if (!['APPROVED', 'REJECTED'].includes(input.decision) || (input.decision === 'APPROVED' && !input.roleId)) throw appError('Pilih role untuk persetujuan.', 422);
  return db.transaction(async tx => {
    // Recheck reviewer authority inside the same transaction as the approval.
    const [reviewer] = await tx.select({ active: users.isActive, mustChange: users.mustChangePassword, role: roles.code, roleActive: roles.isActive })
      .from(users).innerJoin(roles, eq(users.roleId, roles.id)).where(eq(users.id, actor.userId)).for('share');
    if (!reviewer?.active || !reviewer.roleActive || reviewer.mustChange || !['OWNER', 'DIRECTOR'].includes(reviewer.role)) throw appError('Akses ditolak.', 403, 'FORBIDDEN');
    const [request] = await tx.select().from(accessRequests).where(eq(accessRequests.id, input.id)).for('update');
    if (!request || request.status !== 'PENDING') throw appError('Request tidak tersedia atau sudah ditinjau.', 409, 'REQUEST_REVIEWED');
    if (input.decision === 'APPROVED') {
      const [role] = await tx.select({ id: roles.id }).from(roles).where(and(eq(roles.id, input.roleId!), eq(roles.isActive, true))).for('share');
      if (!role) throw appError('Role tidak aktif atau tidak tersedia.', 422, 'INVALID_ROLE');
      const [created] = await tx.insert(users).values({ email: request.email, fullName: request.fullName, roleId: role.id })
        .onConflictDoNothing().returning({ id: users.id });
      if (!created) throw appError('User sudah ada. Kelola akun yang ada terlebih dahulu.', 409, 'USER_EXISTS');
    }
    await tx.update(accessRequests).set({ status: input.decision, reviewedAt: new Date(), reviewedByUserId: actor.userId,
      approvedRoleId: input.decision === 'APPROVED' ? input.roleId : null }).where(eq(accessRequests.id, request.id));
    await tx.insert(auditLogs).values({ actorUserId: actor.userId, action: `ACCESS_${input.decision}`, module: 'AUTH', entityType: 'access_request', entityId: request.id,
      source: 'WEB', afterData: { status: input.decision, approvedRoleId: input.decision === 'APPROVED' ? input.roleId : null } });
    return { id: request.id, status: input.decision };
  });
}
