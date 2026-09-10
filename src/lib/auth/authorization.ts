import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { findActiveActorByEmail, type ActorContext } from "./identity-context";
import type { PermissionCode } from "./permissions";

export type { ActorContext } from "./identity-context";

export async function getCurrentActor(options: { allowPasswordChange?: boolean } = {}): Promise<ActorContext | null> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;
  const actor = await findActiveActorByEmail(email);
  if (actor?.mustChangePassword && !options.allowPasswordChange) return null;
  return actor;
}

export async function requireActor(): Promise<ActorContext> {
  const actor = await getCurrentActor({ allowPasswordChange: true });
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");
  return actor;
}

export async function requirePermission(permission: PermissionCode): Promise<ActorContext> {
  const actor = await requireActor();
  if (!actor.permissions.includes(permission)) redirect("/unauthorized");
  return actor;
}

export function assertPermission(actor: ActorContext, permission: PermissionCode): void {
  if (!actor.permissions.includes(permission)) {
    const error = new Error(`Missing permission: ${permission}`);
    (error as Error & { status?: number; code?: string }).status = 403;
    (error as Error & { status?: number; code?: string }).code = "FORBIDDEN";
    throw error;
  }
}
