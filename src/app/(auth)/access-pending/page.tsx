import Link from "next/link";
import { googleLoginWithAnotherAccount } from "../login/google-actions";

export default async function AccessPendingPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const pending = (await searchParams).status === 'pending';
  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="brand-kicker">dopamin coffee & workspace</div>
        <h1>Akses Belum Tersedia</h1>
        <p>Akun Google yang Anda gunakan belum terdaftar atau belum aktif di Dopamin Cafe.</p>
        {pending && <p role="status">Permintaan akses Anda telah dicatat dan sedang menunggu persetujuan Owner atau Director. Silakan coba login kembali setelah disetujui.</p>}
        <p className="muted">Silakan hubungi Owner atau Administrator untuk mendapatkan akses.</p>
        <div className="form-stack">
          <Link className="secondary-button" href="/login">Kembali ke Login</Link>
          <form action={googleLoginWithAnotherAccount}>
            <button className="primary-button" type="submit" style={{ width: "100%" }}>Gunakan Akun Google Lain</button>
          </form>
        </div>
      </section>
    </main>
  );
}
