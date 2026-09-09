"use client";

import { useEffect, useRef, useState } from "react";

export function RegisterServiceWorker() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const refreshing = useRef(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let active = true;

    navigator.serviceWorker.register("/sw.js").then((registration) => {
      if (!active) return;
      if (registration.waiting) setWaiting(registration.waiting);
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) setWaiting(worker);
        });
      });
    }).catch((error) => console.error("PWA service worker registration failed", error));

    const onControllerChange = () => {
      if (refreshing.current) return;
      refreshing.current = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    return () => { active = false; navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange); };
  }, []);

  if (!waiting) return null;
  return <div className="pwa-update-banner" role="status">
    <span>Versi aplikasi baru tersedia.</span>
    <button className="primary-button" type="button" onClick={() => waiting.postMessage({ type: "SKIP_WAITING" })}>Perbarui sekarang</button>
  </div>;
}
