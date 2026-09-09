import { correlationId, fail, ok, requireApiActor } from "@/lib/http/api";
import { getStockOpnameSession } from "@/modules/inventory/stock-opname.service";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const cid = correlationId(request);
  try { const { id } = await params; return ok(await getStockOpnameSession(await requireApiActor(), id), cid); }
  catch (error) { return fail(error, cid, "STOCK_SESSION_DETAIL_FAILED"); }
}
