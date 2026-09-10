"use client";

import { useActionState } from "react";
import { passwordLogin } from "@/app/(auth)/login/actions";

export function LoginForm({ initialError = "" }: { initialError?: string }) {
  const [error, action, pending] = useActionState(passwordLogin, initialError);
  return <form action={action} className="form-stack">
    <label>Email<input name="email" type="email" autoComplete="username" required maxLength={320} /></label>
    <label>Password<input name="password" type="password" autoComplete="current-password" required maxLength={72} /></label>
    {error && <p className="error-text" role="alert">{error}</p>}
    <button className="primary-button" type="submit" disabled={pending}>{pending ? "Memproses…" : "Masuk"}</button>
  </form>;
}
