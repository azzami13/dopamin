"use client";
export default function ErrorState({reset}: {error: Error & {digest?: string}; reset: () => void}) { return <section className="panel empty-state" role="alert"><div className="brand-kicker">Dopamin Cafe</div><h1>Halaman belum dapat dimuat</h1><p>Periksa koneksi Anda, lalu coba kembali.</p><button className="primary-button" onClick={reset}>Coba lagi</button></section>; }
