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
  return <main className="flex min-h-screen items-center justify-center p-6">
    <section className="space-y-4 text-center" aria-live="polite">
      <h1 className="text-2xl font-semibold">Verifikasi akun Google berhasil</h1>
      <p>Menyiapkan akses ke semua fitur Dopamin Cafe.</p>
      <p>Masuk ke dashboard dalam {seconds} detik...</p>
    </section>
  </main>;
}
