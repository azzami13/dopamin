import { createHmac, timingSafeEqual } from "node:crypto";

export function signBody(body: string, timestamp: string, secret: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
}

export function verifySignedRequest(input: {
  body: string;
  timestamp: string | null;
  signature: string | null;
  secret: string;
  now?: number;
  maxSkewSeconds?: number;
}): boolean {
  const { body, timestamp, signature, secret } = input;
  if (!timestamp || !signature) return false;
  const epoch = Number(timestamp);
  if (!Number.isFinite(epoch)) return false;
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - epoch) > (input.maxSkewSeconds ?? 300)) return false;
  const expected = signBody(body, timestamp, secret);
  const provided = signature.replace(/^sha256=/, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(provided)) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"));
}
