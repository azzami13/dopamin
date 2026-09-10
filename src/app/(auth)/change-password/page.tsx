import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/authorization";
import { PASSWORD_RULE } from "@/lib/auth/password";
import { signOut } from "@/auth";
import { ChangePasswordForm } from "@/components/auth/change-password-form";

export default async function ChangePasswordPage() {
  const actor = await getCurrentActor({ allowPasswordChange: true });
  if (!actor) redirect("/login");
  return <main className="login-shell"><section className="login-card">
    <h1>Ganti password</h1>
    {actor.mustChangePassword && <p>Password sementara wajib diganti sebelum melanjutkan.</p>}
    <p className="muted">{PASSWORD_RULE} Gunakan password yang berbeda dari sebelumnya.</p>
    <p className="muted">Jika akun hanya memakai Google dan belum memiliki password, hubungi administrator untuk menetapkan password awal.</p>
    <ChangePasswordForm />
    <form action={async () => { "use server"; await signOut({ redirectTo: "/login" }); }} style={{ marginTop: 16 }}>
      <button className="secondary-button" type="submit">Keluar</button>
    </form>
  </section></main>;
}
