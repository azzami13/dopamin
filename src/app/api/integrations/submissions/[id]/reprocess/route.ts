import { z } from "zod";
import { correlationId, fail, ok, requireApiActor } from "@/lib/http/api";
import { reprocessSubmission } from "@/modules/integration/reprocess.service";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const cid = correlationId(request);
  try {
    const actor = await requireApiActor();
    const id = z.string().uuid().parse((await params).id);
    const body = z.object({ reason: z.string().trim().min(1).max(2000) }).parse(await request.json());
    return ok(await reprocessSubmission(actor, id, body.reason), cid);
  } catch (error) { return fail(error, cid, "REPROCESS_FAILED"); }
}
