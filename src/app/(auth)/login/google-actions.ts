"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";

async function startGoogleLogin(selectAccount: boolean) {
  try {
    await signIn("google", { redirectTo: "/dashboard" }, selectAccount ? { prompt: "select_account" } : undefined);
  } catch (error) {
    if (error instanceof AuthError) redirect("/auth-error");
    throw error; // Keep the successful OAuth redirect intact.
  }
}

export async function googleLogin() { await startGoogleLogin(false); }
export async function googleLoginWithAnotherAccount() { await startGoogleLogin(true); }
