import { correlationId, fail, ok, requireApiActor } from "@/lib/http/api";
import { reviewStockOpname } from "@/modules/inventory/stock-opname.service";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const cid = correlationId(request);
  try { const { id } = await params; return ok(await reviewStockOpname(await requireApiActor(), id), cid); }
  catch (error) { return fail(error, cid, "STOCK_REVIEW_FAILED"); }
}
