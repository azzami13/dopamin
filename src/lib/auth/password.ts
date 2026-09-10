import { compare, hash } from "bcryptjs";

export const LOGIN_ERROR = "Email atau password tidak valid.";
export const PASSWORD_RULE = "Password minimal 12 karakter, dengan huruf besar, huruf kecil, angka, dan simbol; maksimal 72 byte UTF-8.";
export const PASSWORD_COST = 12;
export const MAX_FAILURES = 5;
export const LOCK_MS = 15 * 60 * 1000;

export function validPassword(value: unknown): value is string {
  return typeof value === "string" && [...value].length >= 12 && Buffer.byteLength(value, "utf8") <= 72
    && /[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9]/.test(value) && /[^A-Za-z0-9\s]/.test(value);
}

export function acceptableLoginPassword(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= 72;
}

export async function hashPassword(value: string): Promise<string> {
  if (!validPassword(value)) throw new Error(PASSWORD_RULE);
  return hash(value, PASSWORD_COST);
}

// Equal-cost verification for unknown users / Google-only accounts. Not a user credential.
let dummyHash: Promise<string> | undefined;
export async function verifyPassword(value: string, storedHash: string | null): Promise<boolean> {
  const candidate = storedHash ?? await (dummyHash ??= hash("Dummy-account-check-only!2026", PASSWORD_COST));
  const matches = await compare(value, candidate);
  return storedHash !== null && matches;
}

export function failedAttempt(state: { failedLoginAttempts: number; lockedUntil: Date | null }, now: Date) {
  const previous = state.lockedUntil && state.lockedUntil <= now ? 0 : state.failedLoginAttempts;
  const attempts = Math.min(previous + 1, MAX_FAILURES);
  return { failedLoginAttempts: attempts, lockedUntil: attempts >= MAX_FAILURES ? new Date(now.getTime() + LOCK_MS) : null };
}
