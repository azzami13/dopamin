import { z } from "zod";
import { correlationId, fail, ok, requireApiActor } from "@/lib/http/api";
import { createStockOpnameSession, listStockOpnameSessions } from "@/modules/inventory/stock-opname.service";
const schema = z.object({ businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), category: z.enum(["KITCHEN", "BAR", "OTHER"]) });
export async function GET(request: Request) {
  const cid = correlationId(request);
  try { const u = new URL(request.url); return ok(await listStockOpnameSessions(await requireApiActor(), { businessDate: u.searchParams.get("businessDate") ?? undefined, category: u.searchParams.get("category") ?? undefined }), cid); }
  catch (error) { return fail(error, cid, "STOCK_SESSION_LIST_FAILED"); }
}
export async function POST(request: Request) {
  const cid = correlationId(request);
  try { return ok(await createStockOpnameSession(await requireApiActor(), schema.parse(await request.json())), cid, 201); }
  catch (error) { return fail(error, cid, "STOCK_SESSION_CREATE_FAILED"); }
}
