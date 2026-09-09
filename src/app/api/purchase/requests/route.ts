import { z } from "zod";
import { correlationId, fail, ok, requireApiActor } from "@/lib/http/api";
import { createPurchaseRequest, listPurchaseRequests } from "@/modules/purchase/purchase.service";

const item = z.object({ itemName: z.string().min(1).max(200), quantity: z.string().min(1), unit: z.string().min(1).max(40), estimatedUnitCost: z.string().min(1) });
const createSchema = z.object({ requestDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), purpose: z.string().min(1), items: z.array(item).min(1) });

export async function GET(request: Request) {
  const cid = correlationId(request);
  try { return ok(await listPurchaseRequests(await requireApiActor()), cid); }
  catch (error) { return fail(error, cid, "PURCHASE_LIST_FAILED"); }
}

export async function POST(request: Request) {
  const cid = correlationId(request);
  try {
    const input = createSchema.parse(await request.json());
    return ok(await createPurchaseRequest(await requireApiActor(), input), cid, 201);
  } catch (error) { return fail(error, cid, "PURCHASE_CREATE_FAILED"); }
}
