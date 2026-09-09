import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  try {
    await db.execute(sql`select 1 as healthy`);
    return NextResponse.json({
      ok: true,
      service: "dopamin-cafe-accounting-inventory",
      status: "healthy",
      database: "reachable",
      latencyMs: Date.now() - startedAt,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({
      ok: false,
      service: "dopamin-cafe-accounting-inventory",
      status: "unhealthy",
      database: "unreachable",
      latencyMs: Date.now() - startedAt,
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
