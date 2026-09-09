import { z } from "zod";
import { correlationId, fail, ok, requireApiActor } from "@/lib/http/api";
import { getDailyReportSettings, saveDailyReportSettings } from "@/modules/reporting/report-settings.service";
const schema = z.object({ enabled: z.boolean(), sendTime: z.string(), timezone: z.literal("Asia/Jakarta").default("Asia/Jakarta"), recipients: z.array(z.object({ email: z.string().email(), recipientName: z.string().optional(), isEnabled: z.boolean().optional() })) });
export async function GET(request: Request) { const cid=correlationId(request); try { return ok(await getDailyReportSettings(await requireApiActor()),cid); } catch(error){ return fail(error,cid,"REPORT_SETTINGS_GET_FAILED"); } }
export async function PUT(request: Request) { const cid=correlationId(request); try { return ok(await saveDailyReportSettings(await requireApiActor(),schema.parse(await request.json())),cid); } catch(error){ return fail(error,cid,"REPORT_SETTINGS_SAVE_FAILED"); } }
