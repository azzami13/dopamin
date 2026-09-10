import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

export type AppError = Error & { status?: number; code?: string; details?: unknown };

export function correlationId(request: Request): string {
  return request.headers.get("x-correlation-id") ?? randomUUID();
}

export function ok(data: unknown, correlation: string, status = 200) {
  return NextResponse.json({ ok: true, data, correlationId: correlation }, { status });
}

export function fail(error: unknown, correlation: string, fallbackCode = "REQUEST_FAILED") {
  const e = error as AppError;
  if (error instanceof ZodError) {
    return NextResponse.json(
      { ok: false, error: { code: "VALIDATION_ERROR", message: "Request validation failed", details: error.flatten() }, correlationId: correlation },
      { status: 422 },
    );
  }
  return NextResponse.json(
    { ok: false, error: { code: e.code ?? fallbackCode, message: e.message ?? "Unexpected error", details: e.details }, correlationId: correlation },
    { status: e.status ?? 500 },
  );
}

export function appError(message: string, status = 422, code = "INVALID_REQUEST", details?: unknown): AppError {
  return Object.assign(new Error(message), { status, code, details });
}

export async function requireApiActor() {
  const { getCurrentActor } = await import("@/lib/auth/authorization");
  const actor = await getCurrentActor({ allowPasswordChange: true });
  if (!actor) throw appError("Authentication required", 401, "UNAUTHENTICATED");
  if (actor.mustChangePassword) throw appError("Password wajib diganti terlebih dahulu.", 403, "PASSWORD_CHANGE_REQUIRED");
  return actor;
}
