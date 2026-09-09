import { z } from "zod";
import { correlationId, fail, ok, requireApiActor } from "@/lib/http/api";
import { recordPurchaseReceipt } from "@/modules/purchase/purchase.service";
const schema = z.object({ storageProvider: z.string().min(1).default("GOOGLE_DRIVE"), storageFileId: z.string().min(1), fileUrl: z.string().url(), fundTransactionId: z.string().uuid().optional() });
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const cid = correlationId(request);
  try { const { id } = await params; return ok(await recordPurchaseReceipt(await requireApiActor(), id, schema.parse(await request.json())), cid, 201); }
  catch (error) { return fail(error, cid, "PURCHASE_RECEIPT_FAILED"); }
}
