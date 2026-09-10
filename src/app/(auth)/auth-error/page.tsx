import Link from "next/link";

export default function AuthErrorPage() {
  // Never render Auth.js query parameters or exception details.
  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="brand-kicker">dopamin coffee & workspace</div>
        <h1>Login Belum Berhasil</h1>
        <p>Proses login belum dapat diselesaikan. Silakan coba kembali.</p>
        <p className="muted">Jika masalah berlanjut, hubungi Owner atau Administrator.</p>
        <Link className="secondary-button" href="/login">Kembali ke Login</Link>
      </section>
    </main>
  );
}
