"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function VerificationCountdown() {
  const router = useRouter();
  const [seconds, setSeconds] = useState(5);
  useEffect(() => {
    const started = Date.now();
    const interval = setInterval(() => setSeconds(Math.max(0, 5 - Math.floor((Date.now() - started) / 1000))), 250);
    const timeout = setTimeout(() => router.replace("/dashboard"), 5000);
    return () => { clearInterval(interval); clearTimeout(timeout); };
  }, [router]);
  return <main className="center-state">
    <section className="login-card empty-state" aria-live="polite">
      <h1 >Verifikasi akun Google berhasil</h1>
      <p>Menyiapkan akses ke semua fitur Dopamin Cafe.</p>
      <p>Masuk ke dashboard dalam {seconds} detik...</p>
    </section>
  </main>;
}
