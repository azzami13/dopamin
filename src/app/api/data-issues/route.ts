import { correlationId, fail, ok, requireApiActor } from "@/lib/http/api";
import { listDataIssues } from "@/modules/correction/correction.service";
export async function GET(request: Request) {
  const cid = correlationId(request);
  try {
    const url = new URL(request.url);
    return ok(await listDataIssues(await requireApiActor(), { status: url.searchParams.get("status") ?? undefined, severity: url.searchParams.get("severity") ?? undefined }), cid);
  } catch (error) { return fail(error, cid, "DATA_ISSUES_FAILED"); }
}
