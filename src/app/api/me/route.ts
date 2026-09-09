import { NextResponse } from "next/server";
import { getCurrentActor } from "@/lib/auth/authorization";
export async function GET() {
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.json({ ok: false, error: { code: "UNAUTHENTICATED", message: "Authentication required" } }, { status: 401 });
  return NextResponse.json({ ok: true, data: actor });
}
