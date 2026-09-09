import { z } from "zod";
import { correlationId, fail, ok, requireApiActor } from "@/lib/http/api";
import { createCorrection } from "@/modules/correction/correction.service";
const schema = z.object({ entityType: z.enum(["PAYMENT_LINE","CASHIER_EXPENSE_LINE","CASH_COUNT","SALES_REPORT_ITEM","CASHIER_REPORT","SALES_REPORT"]), entityId: z.string().uuid(), fieldName: z.string().min(1), newValue: z.unknown(), reason: z.string().min(1), issueId: z.string().uuid().optional() });
export async function POST(request: Request) {
  const cid = correlationId(request);
  try { return ok(await createCorrection(await requireApiActor(), schema.parse(await request.json())), cid, 201); }
  catch (error) { return fail(error, cid, "CORRECTION_FAILED"); }
}
