import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  try {
    const rows = await db.execute(sql`select now() as db_time`);
    const row = (rows as unknown as Array<Record<string, unknown>>)[0] ?? {};
    return NextResponse.json({
      ok: true,
      service: "dopamin-cafe-accounting-inventory",
      status: "healthy",
      database: "reachable",
      dbTime: row.db_time ?? null,
      latencyMs: Date.now() - startedAt,
      timezone: "Asia/Jakarta",
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      service: "dopamin-cafe-accounting-inventory",
      status: "unhealthy",
      database: "unreachable",
      error: error instanceof Error ? error.message : "Unknown database error",
      latencyMs: Date.now() - startedAt,
    }, { status: 503 });
  }
}
