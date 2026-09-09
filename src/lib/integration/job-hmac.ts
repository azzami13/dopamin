import { timingSafeEqual, createHmac } from "node:crypto";

export function verifyJobRequest(input: { body: string; timestamp: string | null; signature: string | null; secret: string; replaySeconds?: number }): boolean {
  const { body, timestamp, signature, secret, replaySeconds = 300 } = input;
  if (!timestamp || !signature) return false;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - seconds) > replaySeconds) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
