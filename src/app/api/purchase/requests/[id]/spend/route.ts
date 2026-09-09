import { z } from "zod";
import { correlationId, fail, ok, requireApiActor } from "@/lib/http/api";
import { recordPurchaseSpend } from "@/modules/purchase/purchase.service";
const schema = z.object({ businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), amount: z.string().min(1), expenseCategoryCode: z.string().min(1), description: z.string().min(1), counterpartyName: z.string().optional(), referenceNo: z.string().optional(), receiptReference: z.string().optional() });
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const cid = correlationId(request);
  try { const { id } = await params; return ok(await recordPurchaseSpend(await requireApiActor(), id, schema.parse(await request.json())), cid, 201); }
  catch (error) { return fail(error, cid, "PURCHASE_SPEND_FAILED"); }
}
