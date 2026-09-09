import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { verifySignedRequest } from "@/lib/integration/hmac";
import { ingestGoogleForm } from "@/modules/integration/ingestion.service";
import {
  googleFormEnvelopeSchema,
  googleSourceKeySchema,
} from "@/modules/integration/types";

const MAX_WEBHOOK_BODY_BYTES =
  1_000_000;

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      sourceKey: string;
    }>;
  },
) {
  const correlationId =
    request.headers.get(
      "x-correlation-id",
    ) ?? randomUUID();

  /*
   * Tolak body yang jelas terlalu besar
   * sebelum membacanya.
   */
  const contentLength =
    request.headers.get(
      "content-length",
    );

  if (contentLength) {
    const declared =
      Number(contentLength);

    if (
      Number.isFinite(declared) &&
      declared >
        MAX_WEBHOOK_BODY_BYTES
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code:
              "PAYLOAD_TOO_LARGE",
            message:
              "Webhook payload is too large",
          },
          correlationId,
        },
        {
          status: 413,
        },
      );
    }
  }

  const rawBody =
    await request.text();

  if (
    Buffer.byteLength(
      rawBody,
      "utf8",
    ) >
    MAX_WEBHOOK_BODY_BYTES
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code:
            "PAYLOAD_TOO_LARGE",
          message:
            "Webhook payload is too large",
        },
        correlationId,
      },
      {
        status: 413,
      },
    );
  }

  const secret =
    process.env
      .GOOGLE_INTEGRATION_SECRET;

  /*
   * Jangan jalankan webhook
   * dengan secret pendek/kosong.
   */
  if (
    !secret ||
    secret.length < 32
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code:
            "SERVER_NOT_CONFIGURED",
          message:
            "Integration secret is not configured correctly",
        },
        correlationId,
      },
      {
        status: 503,
      },
    );
  }

  const signatureValid =
    verifySignedRequest({
      body: rawBody,
      timestamp:
        request.headers.get(
          "x-dopamin-timestamp",
        ),
      signature:
        request.headers.get(
          "x-dopamin-signature",
        ),
      secret,
    });

  if (!signatureValid) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code:
            "INVALID_SIGNATURE",
          message:
            "Invalid or expired integration signature",
        },
        correlationId,
      },
      {
        status: 401,
      },
    );
  }

  try {
    /*
     * Parse ORIGINAL SIGNED BODY.
     *
     * Jangan overwrite sourceKey.
     */
    const json =
      JSON.parse(rawBody) as unknown;

    const parsed =
      googleFormEnvelopeSchema.parse(
        json,
      );

    const route =
      await params;

    const parsedRoute =
      googleSourceKeySchema.safeParse(
        route.sourceKey,
      );

    if (!parsedRoute.success) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code:
              "SOURCE_NOT_SUPPORTED",
            message:
              "Unsupported integration source",
          },
          correlationId,
        },
        {
          status: 404,
        },
      );
    }

    /*
     * Signed sourceKey harus sama
     * dengan route sourceKey.
     */
    if (
      parsed.sourceKey !==
      parsedRoute.data
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code:
              "SOURCE_KEY_MISMATCH",
            message:
              "Source key does not match webhook route",
          },
          correlationId,
        },
        {
          status: 409,
        },
      );
    }

    const result =
      await ingestGoogleForm(
        parsed,
        correlationId,
      );

    return NextResponse.json(
      {
        ok: true,
        data: result,
        correlationId,
      },
      {
        status:
          result.idempotent
            ? 200
            : 201,
      },
    );
  } catch (error) {
    const e = error as Error & {
      status?: number;
      code?: string;
      issues?: unknown;
    };

    return NextResponse.json(
      {
        ok: false,
        error: {
          code:
            e.code ??
            "INGESTION_FAILED",
          message:
            e.message,
          details:
            e.issues,
        },
        correlationId,
      },
      {
        status:
          e.status ?? 422,
      },
    );
  }
}
