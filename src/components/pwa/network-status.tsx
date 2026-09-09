"use client";

import { useEffect, useState } from "react";

export function useOnlineState() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  return online;
}

export function NetworkStatus() {
  const online = useOnlineState();
  if (online) return null;
  return <div role="status" aria-live="polite" style={{ padding: 8, textAlign: "center", background: "#DED7BE", color: "#1D271E" }}>Tidak ada koneksi internet. Data keuangan, approval, correction, dan perubahan settings tidak dapat disimpan sampai koneksi kembali.</div>;
}
