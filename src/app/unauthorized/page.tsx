import Link from "next/link";
export default function UnauthorizedPage() {
  return <main className="center-state"><h1>Akses ditolak</h1><p>Akun Anda tidak memiliki izin untuk tindakan atau halaman ini.</p><Link href="/dashboard">Kembali ke Dashboard</Link></main>;
}
