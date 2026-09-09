import { z } from "zod";
import { correlationId, fail, ok, requireApiActor } from "@/lib/http/api";
import { decidePurchaseRequest } from "@/modules/purchase/purchase.service";
const schema = z.object({ action: z.enum(["APPROVE", "REVISE", "REJECT"]), reason: z.string().optional(), fundAccountCode: z.string().optional() });
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const cid = correlationId(request);
  try { const { id } = await params; return ok(await decidePurchaseRequest(await requireApiActor(), id, schema.parse(await request.json())), cid); }
  catch (error) { return fail(error, cid, "PURCHASE_DECISION_FAILED"); }
}
