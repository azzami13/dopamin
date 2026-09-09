import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import type { ActorContext } from "@/lib/auth/authorization";
import { Permission } from "@/lib/auth/permissions";
import { appError } from "@/lib/http/api";

function rows<T = Record<string, unknown>>(value: unknown): T[] { return value as T[]; }

export async function listAuditEvents(actor: ActorContext, input: { from?: string; to?: string; module?: string; action?: string }) {
  const full = actor.permissions.includes(Permission.AUDIT_VIEW);
  const limited = actor.permissions.includes(Permission.AUDIT_VIEW_LIMITED);
  if (!full && !limited) throw appError("Audit permission is required", 403, "FORBIDDEN");
  const from = input.from ?? "2000-01-01";
  const to = input.to ?? "2999-12-31";
  const result = await db.execute(sql`
    select al.id, al.created_at, al.action, al.module, al.entity_type, al.entity_id,
      al.actor_role, al.reason, al.source, al.correlation_id,
      coalesce(u.full_name,'SYSTEM') as actor_name
    from audit_logs al left join users u on u.id=al.actor_user_id
    where al.created_at >= ${from}::date
      and al.created_at < (${to}::date + interval '1 day')
      and (${input.module ?? null}::text is null or al.module=${input.module ?? null})
      and (${input.action ?? null}::text is null or al.action=${input.action ?? null})
      and (${full} or al.module in ('PURCHASE','INVENTORY','CORRECTION','INTEGRATION'))
    order by al.created_at desc limit 500
  `);
  return rows(result);
}

export async function getAuditEvent(actor: ActorContext, id: string) {
  const full = actor.permissions.includes(Permission.AUDIT_VIEW);
  const limited = actor.permissions.includes(Permission.AUDIT_VIEW_LIMITED);
  if (!full && !limited) throw appError("Audit permission is required", 403, "FORBIDDEN");
  const result = await db.execute(sql`
    select al.*, coalesce(u.full_name,'SYSTEM') as actor_name, u.email as actor_email
    from audit_logs al left join users u on u.id=al.actor_user_id where al.id=${id}::uuid limit 1
  `);
  const event = rows(result)[0];
  if (!event) throw appError("Audit event not found", 404, "AUDIT_EVENT_NOT_FOUND");
  if (!full && !['PURCHASE','INVENTORY','CORRECTION','INTEGRATION'].includes(String(event.module))) throw appError("Audit event is outside role scope", 403, "FORBIDDEN");
  return event;
}
