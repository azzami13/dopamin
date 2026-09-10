"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { LOGIN_ERROR } from "@/lib/auth/password";

export async function passwordLogin(_previous: string, form: FormData): Promise<string> {
  const email = form.get("email"), password = form.get("password");
  if (typeof email !== "string" || typeof password !== "string") return LOGIN_ERROR;
  try {
    await signIn("credentials", { email, password, redirectTo: "/dashboard" });
  } catch (error) {
    if (error instanceof AuthError) return LOGIN_ERROR;
    throw error; // Preserve Next.js successful-login redirect.
  }
  return LOGIN_ERROR;
}
