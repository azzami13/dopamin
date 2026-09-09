export default function OfflinePage() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#F6F3E9", padding: 24 }}>
      <section style={{ maxWidth: 520, background: "#FBFAF6", padding: 24, borderRadius: 16 }}>
        <h1 style={{ color: "#0A432C" }}>Anda sedang offline</h1>
        <p>Halaman ini membutuhkan koneksi ke server Dopamin Cafe.</p>
        <p>Funding, transfer, pengeluaran, approval, correction, void, dan perubahan settings tidak diantrikan secara offline.</p>
      </section>
    </main>
  );
}
