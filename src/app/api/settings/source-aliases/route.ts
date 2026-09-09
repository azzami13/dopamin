import { z } from "zod";
import { correlationId, fail, ok, requireApiActor } from "@/lib/http/api";
import { listSourceAliases, setSourceAliasActive, upsertSourceAlias } from "@/modules/settings/source-alias.service";

const createSchema = z.object({
  userId: z.string().uuid(),
  sourceCode: z.enum(["CASHIER", "KITCHEN", "BEVERAGE"]),
  alias: z.string().min(1).max(160),
  isActive: z.boolean().optional(),
});
const patchSchema = z.object({ id: z.string().uuid(), isActive: z.boolean() });

export async function GET(request: Request) {
  const cid = correlationId(request);
  try { return ok(await listSourceAliases(await requireApiActor()), cid); }
  catch (error) { return fail(error, cid, "SOURCE_ALIAS_GET_FAILED"); }
}

export async function POST(request: Request) {
  const cid = correlationId(request);
  try { return ok(await upsertSourceAlias(await requireApiActor(), createSchema.parse(await request.json())), cid, 201); }
  catch (error) { return fail(error, cid, "SOURCE_ALIAS_SAVE_FAILED"); }
}

export async function PATCH(request: Request) {
  const cid = correlationId(request);
  try {
    const body = patchSchema.parse(await request.json());
    return ok(await setSourceAliasActive(await requireApiActor(), body.id, body.isActive), cid);
  } catch (error) { return fail(error, cid, "SOURCE_ALIAS_UPDATE_FAILED"); }
}
