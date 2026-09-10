import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApiActor } from '@/lib/http/api';
import { listAccessRequests, reviewAccessRequest } from '@/modules/settings/access-request.service';

const input = z.discriminatedUnion('decision', [
  z.object({ id: z.string().uuid(), decision: z.literal('APPROVED'), roleId: z.string().uuid() }),
  z.object({ id: z.string().uuid(), decision: z.literal('REJECTED') }),
]);
function response(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}
function failure(error: unknown) {
  const status = (error as { status?: number })?.status;
  const messages: Record<number, string> = { 401: 'Silakan masuk kembali.', 403: 'Akses ditolak.', 409: 'Request sudah ditinjau atau user sudah ada. Muat ulang daftar.', 422: 'Pilih role aktif yang valid.' };
  const safeStatus = status && messages[status] ? status : 500;
  return response({ ok: false, error: { message: messages[safeStatus] ?? 'Permintaan belum dapat diproses.' } }, safeStatus);
}
export async function GET() {
  try { return response({ ok: true, data: await listAccessRequests(await requireApiActor()) }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    if (request.headers.get('origin') !== new URL(request.url).origin) return response({ ok: false, error: { message: 'Akses ditolak.' } }, 403);
    const actor = await requireApiActor();
    const parsed = input.safeParse(await request.json());
    if (!parsed.success) return response({ ok: false, error: { message: 'Pilih keputusan dan role yang valid.' } }, 422);
    return response({ ok: true, data: await reviewAccessRequest(actor, parsed.data) });
  } catch (error) { return failure(error); }
}
