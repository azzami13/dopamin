import { correlationId, fail, ok, requireApiActor } from "@/lib/http/api";
import { listInventoryItems } from "@/modules/inventory/stock-opname.service";
export async function GET(request: Request) {
  const cid = correlationId(request);
  try { const category = new URL(request.url).searchParams.get("category") ?? undefined; return ok(await listInventoryItems(await requireApiActor(), category), cid); }
  catch (error) { return fail(error, cid, "INVENTORY_ITEMS_FAILED"); }
}
