"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useOnlineState } from "@/components/pwa/network-status";

export function PurchaseCreateForm({ defaultDate }: { defaultDate: string }) {
  const online = useOnlineState();
  const router = useRouter();
  const [purpose, setPurpose] = useState("");
  const [requestDate, setRequestDate] = useState(defaultDate);
  const [items, setItems] = useState([{ itemName: "", quantity: "1", unit: "pcs", estimatedUnitCost: "0" }]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  function setItem(i: number, key: string, value: string) { setItems((prev) => prev.map((x, idx) => idx === i ? { ...x, [key]: value } : x)); }
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (!online) return; setBusy(true); setError("");
    try {
      const res = await fetch("/api/purchase/requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestDate, purpose, items }) });
      const body = await res.json(); if (!res.ok) throw new Error(body?.error?.message ?? "Gagal membuat Purchase Request");
      router.push(`/purchase/${body.data.id}`); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Gagal"); } finally { setBusy(false); }
  }
  return <form className="panel form-stack" onSubmit={submit}>
    <label>Tanggal Permintaan<input type="date" value={requestDate} onChange={(e)=>setRequestDate(e.target.value)} required /></label>
    <label>Tujuan / Keperluan<textarea value={purpose} onChange={(e)=>setPurpose(e.target.value)} required rows={3}/></label>
    <h2>Items</h2>
    {items.map((item,i)=><div className="line-form-grid" key={i}>
      <input aria-label="Nama item" placeholder="Nama item" value={item.itemName} onChange={(e)=>setItem(i,"itemName",e.target.value)} required />
      <input aria-label="Qty" placeholder="Qty" inputMode="decimal" value={item.quantity} onChange={(e)=>setItem(i,"quantity",e.target.value)} required />
      <input aria-label="Unit" placeholder="Unit" value={item.unit} onChange={(e)=>setItem(i,"unit",e.target.value)} required />
      <input aria-label="Estimasi/unit" placeholder="Estimasi/unit" inputMode="numeric" value={item.estimatedUnitCost} onChange={(e)=>setItem(i,"estimatedUnitCost",e.target.value)} required />
      {items.length>1 && <button className="danger-button" type="button" onClick={()=>setItems((p)=>p.filter((_,idx)=>idx!==i))}>Hapus</button>}
    </div>)}
    <button className="secondary-button" type="button" onClick={()=>setItems((p)=>[...p,{itemName:"",quantity:"1",unit:"pcs",estimatedUnitCost:"0"}])}>+ Tambah item</button>
    {error && <p role="alert" className="error-text">{error}</p>}
    <button className="primary-button" disabled={!online||busy}>{busy?"Menyimpan...":"Simpan Draft"}</button>
    {!online && <p className="muted">Aksi ini membutuhkan koneksi internet.</p>}
  </form>;
}
