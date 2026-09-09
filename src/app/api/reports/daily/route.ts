import { correlationId, fail, ok, requireApiActor } from "@/lib/http/api";
import { listDailyReportRuns } from "@/modules/reporting/daily-report.service";
export async function GET(request: Request){const cid=correlationId(request);try{return ok(await listDailyReportRuns(await requireApiActor()),cid)}catch(error){return fail(error,cid,"REPORT_LIST_FAILED")}}
