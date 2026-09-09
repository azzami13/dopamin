import { z } from "zod";
import { correlationId, fail, ok } from "@/lib/http/api";
import { verifyJobRequest } from "@/lib/integration/job-hmac";
import { recordDailyReportDelivery } from "@/modules/reporting/daily-report.service";

const schema = z.object({ runId: z.string().uuid(), recipientEmail: z.string().email(), status: z.enum(["SENT", "FAILED", "UNKNOWN"]), errorMessage: z.string().optional() });
export async function POST(request: Request) {
  const cid = correlationId(request);
  const body = await request.text();
  const secret = process.env.REPORT_JOB_SECRET;
  if (!secret) return fail(Object.assign(new Error("Report job secret is not configured"), { status: 503, code: "SERVER_NOT_CONFIGURED" }), cid);
  if (!verifyJobRequest({ body, timestamp: request.headers.get("x-dopamin-timestamp"), signature: request.headers.get("x-dopamin-signature"), secret })) {
    return fail(Object.assign(new Error("Invalid or expired report job signature"), { status: 401, code: "INVALID_SIGNATURE" }), cid);
  }
  try { return ok(await recordDailyReportDelivery(schema.parse(JSON.parse(body))), cid); }
  catch (error) { return fail(error, cid, "REPORT_DELIVERY_CALLBACK_FAILED"); }
}
