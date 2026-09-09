import { z } from "zod";
import { correlationId, fail, ok, requireApiActor } from "@/lib/http/api";
import { voidFundTransaction } from "@/modules/correction/correction.service";
const schema = z.object({ reason: z.string().min(1) });
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const cid = correlationId(request);
  try { const { id } = await params; return ok(await voidFundTransaction(await requireApiActor(), id, schema.parse(await request.json()).reason), cid); }
  catch (error) { return fail(error, cid, "FINANCE_VOID_FAILED"); }
}
