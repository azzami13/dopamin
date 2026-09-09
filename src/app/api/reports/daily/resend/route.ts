import { z } from "zod";import { correlationId,fail,ok,requireApiActor } from "@/lib/http/api";import { queueManualReportRevision } from "@/modules/reporting/daily-report.service";
const schema=z.object({businessDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)});
export async function POST(request:Request){const cid=correlationId(request);try{const input=schema.parse(await request.json());return ok(await queueManualReportRevision(await requireApiActor(),input.businessDate),cid,202)}catch(error){return fail(error,cid,"REPORT_RESEND_FAILED")}}
