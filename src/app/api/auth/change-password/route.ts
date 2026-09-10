import { NextResponse } from "next/server";
import { getCurrentActor } from "@/lib/auth/authorization";
import { changePassword } from "@/lib/auth/password-service";
import { LOGIN_ERROR, PASSWORD_RULE } from "@/lib/auth/password";

export async function POST(request: Request) {
  const reply = (status: number, message?: string) => NextResponse.json(message ? { ok: false, error: { message } } : { ok: true }, { status, headers: { "Cache-Control": "no-store" } });
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin) return reply(403, "Permintaan tidak valid.");
    const actor = await getCurrentActor({ allowPasswordChange: true });
    if (!actor) return reply(401, "Silakan masuk kembali.");
    if (!request.headers.get("content-type")?.startsWith("application/json")) return reply(400, "Permintaan tidak valid.");
    const text = await request.text();
    if (text.length > 4096) return reply(400, "Permintaan tidak valid.");
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || body.newPassword !== body.confirmPassword) return reply(422, "Konfirmasi password tidak sama.");
    const result = await changePassword(actor.userId, body.currentPassword, body.newPassword);
    if (result === "INVALID") return reply(400, LOGIN_ERROR);
    if (result === "POLICY") return reply(422, `${PASSWORD_RULE} Password baru harus berbeda.`);
    if (result !== "OK") return reply(503, "Password belum dapat diganti.");
    return reply(200);
  } catch { return reply(400, "Permintaan tidak dapat diproses."); }
}
