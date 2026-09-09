import { z } from "zod";
import { correlationId, fail, ok, requireApiActor } from "@/lib/http/api";
import { saveStockOpnameLines } from "@/modules/inventory/stock-opname.service";
const schema = z.object({ lines: z.array(z.object({ inventoryItemId: z.string().uuid(), referenceQty: z.string().nullable().optional(), actualQty: z.string(), note: z.string().optional() })).min(1) });
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const cid = correlationId(request);
  try { const { id } = await params; return ok(await saveStockOpnameLines(await requireApiActor(), id, schema.parse(await request.json()).lines), cid); }
  catch (error) { return fail(error, cid, "STOCK_LINES_SAVE_FAILED"); }
}
