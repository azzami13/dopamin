"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";

export function ChangePasswordForm() {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  return <form className="form-stack" onSubmit={async (event) => {
    event.preventDefault();
    if (pending) return;
    setPending(true); setError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const response = await fetch("/api/auth/change-password", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: data.get("currentPassword"), newPassword: data.get("newPassword"), confirmPassword: data.get("confirmPassword") }) });
      const result = await response.json();
      form.reset();
      if (!response.ok) { setError(result.error?.message ?? "Password belum dapat diganti."); return; }
      await signOut({ redirectTo: "/login" });
    } catch { setError("Password belum dapat diganti. Coba masuk kembali jika perubahan sudah tersimpan."); }
    finally { setPending(false); }
  }}>
    <label>Password saat ini<input name="currentPassword" type="password" autoComplete="current-password" required maxLength={72} /></label>
    <label>Password baru<input name="newPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={72} /></label>
    <label>Ulangi password baru<input name="confirmPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={72} /></label>
    {error && <p className="error-text" role="alert">{error}</p>}
    <button className="primary-button" disabled={pending} type="submit">{pending ? "Menyimpan…" : "Ganti password"}</button>
  </form>;
}
