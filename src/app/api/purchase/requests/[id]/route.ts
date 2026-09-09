import { z } from "zod";
import { correlationId, fail, ok, requireApiActor } from "@/lib/http/api";
import { getPurchaseRequest, updatePurchaseRequest } from "@/modules/purchase/purchase.service";

const item = z.object({ itemName: z.string().min(1).max(200), quantity: z.string().min(1), unit: z.string().min(1).max(40), estimatedUnitCost: z.string().min(1) });
const updateSchema = z.object({ requestDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), purpose: z.string().min(1), items: z.array(item).min(1) });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const cid = correlationId(request);
  try { const { id } = await params; return ok(await getPurchaseRequest(await requireApiActor(), id), cid); }
  catch (error) { return fail(error, cid, "PURCHASE_DETAIL_FAILED"); }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const cid = correlationId(request);
  try { const { id } = await params; return ok(await updatePurchaseRequest(await requireApiActor(), id, updateSchema.parse(await request.json())), cid); }
  catch (error) { return fail(error, cid, "PURCHASE_UPDATE_FAILED"); }
}
