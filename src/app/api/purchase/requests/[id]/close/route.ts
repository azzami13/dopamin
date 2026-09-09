import { correlationId, fail, ok, requireApiActor } from "@/lib/http/api";
import { closePurchaseRequest } from "@/modules/purchase/purchase.service";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const cid = correlationId(request);
  try { const { id } = await params; return ok(await closePurchaseRequest(await requireApiActor(), id), cid); }
  catch (error) { return fail(error, cid, "PURCHASE_CLOSE_FAILED"); }
}
