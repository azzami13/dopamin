import { auditLogs } from "@/db/schema";
import type { ActorContext } from "@/lib/auth/identity-context";

export async function writeAudit(dbLike: any, actor: ActorContext, input: Omit<typeof auditLogs.$inferInsert, "actorUserId" | "actorRole" | "source">) {
  await dbLike.insert(auditLogs).values({ ...input, actorUserId: actor.userId, actorRole: actor.role, source: "WEB" });
}
