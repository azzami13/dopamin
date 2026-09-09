import { correlationId, fail, ok, requireApiActor } from "@/lib/http/api";
import { submitPurchaseRequest } from "@/modules/purchase/purchase.service";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const cid = correlationId(request);
  try { const { id } = await params; return ok(await submitPurchaseRequest(await requireApiActor(), id), cid); }
  catch (error) { return fail(error, cid, "PURCHASE_SUBMIT_FAILED"); }
}
