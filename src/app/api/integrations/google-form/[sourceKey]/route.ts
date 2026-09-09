import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { verifySignedRequest } from "@/lib/integration/hmac";
import { ingestGoogleForm } from "@/modules/integration/ingestion.service";
import { googleFormEnvelopeSchema } from "@/modules/integration/types";

export async function POST(request: Request, { params }: { params: Promise<{ sourceKey: string }> }) {
  const correlationId = request.headers.get("x-correlation-id") ?? randomUUID();
  const rawBody = await request.text();
  const secret = process.env.GOOGLE_INTEGRATION_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: { code: "SERVER_NOT_CONFIGURED", message: "Integration secret is not configured" }, correlationId }, { status: 503 });
  if (!verifySignedRequest({ body: rawBody, timestamp: request.headers.get("x-dopamin-timestamp"), signature: request.headers.get("x-dopamin-signature"), secret })) {
    return NextResponse.json({ ok: false, error: { code: "INVALID_SIGNATURE", message: "Invalid or expired integration signature" }, correlationId }, { status: 401 });
  }

  try {
    const json = JSON.parse(rawBody) as unknown;
    const route = await params;
    const parsed = googleFormEnvelopeSchema.parse({ ...(json as object), sourceKey: route.sourceKey });
    const result = await ingestGoogleForm(parsed, correlationId);
    return NextResponse.json({ ok: true, data: result, correlationId }, { status: result.idempotent ? 200 : 201 });
  } catch (error) {
    const e = error as Error & { status?: number; code?: string; issues?: unknown };
    return NextResponse.json({ ok: false, error: { code: e.code ?? "INGESTION_FAILED", message: e.message, details: e.issues }, correlationId }, { status: e.status ?? 422 });
  }
}
