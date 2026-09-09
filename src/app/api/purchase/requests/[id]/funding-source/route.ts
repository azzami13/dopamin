import { z } from "zod";
import { correlationId, fail, ok, requireApiActor } from "@/lib/http/api";
import { setPurchaseFundingSource } from "@/modules/purchase/purchase.service";
const schema = z.object({ fundAccountCode: z.string().min(1) });
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const cid = correlationId(request);
  try { const { id } = await params; const input = schema.parse(await request.json()); return ok(await setPurchaseFundingSource(await requireApiActor(), id, input.fundAccountCode), cid); }
  catch (error) { return fail(error, cid, "PURCHASE_FUNDING_FAILED"); }
}
