"use client";

import { ResponsiveTable } from "@/components/ui/responsive-table";
import { useMemo, useState } from "react";

type Alias = { id: string; userId: string; userName: string; userEmail: string; role: string; sourceCode: string; alias: string; isActive: boolean };
type User = { id: string; fullName: string; email: string; role: string; isActive: boolean };

export function SourceAliasManager({ initialAliases, users }: { initialAliases: Alias[]; users: User[] }) {
  const [aliases, setAliases] = useState(initialAliases);
  const [userId, setUserId] = useState(users.find((u) => u.isActive)?.id ?? "");
  const [sourceCode, setSourceCode] = useState("CASHIER");
  const [alias, setAlias] = useState("");
  const [message, setMessage] = useState("");
  const eligibleUsers = useMemo(() => users.filter((u) => u.isActive), [users]);

  async function refresh() {
    const response = await fetch("/api/settings/source-aliases", { cache: "no-store" });
    const json = await response.json();
    if (json.ok) setAliases(json.data.aliases);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault(); setMessage("");
    const response = await fetch("/api/settings/source-aliases", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, sourceCode, alias }),
    });
    const json = await response.json();
    if (!json.ok) return setMessage(json.error?.message ?? "Gagal menyimpan alias");
    setAlias(""); setMessage("Alias tersimpan."); await refresh();
  }

  async function toggle(item: Alias) {
    const response = await fetch("/api/settings/source-aliases", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: item.id, isActive: !item.isActive }),
    });
    const json = await response.json();
    if (!json.ok) return setMessage(json.error?.message ?? "Gagal mengubah alias");
    await refresh();
  }

  return <section className="panel">
    <h2>User Source Aliases</h2>
    <p className="muted">Memetakan nama yang muncul pada Google Form ke user aplikasi. Nama yang tidak terpetakan akan ditandai <code>USER_NOT_RESOLVED</code> dan membutuhkan review.</p>
    <form className="inline-form" onSubmit={save}>
      <label>User<select value={userId} onChange={(e) => setUserId(e.target.value)}>{eligibleUsers.map((u) => <option key={u.id} value={u.id}>{u.fullName} — {u.role}</option>)}</select></label>
      <label>Source<select value={sourceCode} onChange={(e) => setSourceCode(e.target.value)}><option>CASHIER</option><option>KITCHEN</option><option>BEVERAGE</option></select></label>
      <label>Alias<input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="Nama persis/variasi pada Form" required /></label>
      <button className="primary-button" type="submit">Simpan alias</button>
    </form>
    {message && <p className="muted">{message}</p>}
    <ResponsiveTable className="table-wrap">
      <table className="data-table"><thead><tr><th>Source</th><th>Alias</th><th>User</th><th>Role</th><th>Status</th><th>Aksi</th></tr></thead><tbody>
        {aliases.map((item) => <tr key={item.id}><td>{item.sourceCode}</td><td>{item.alias}</td><td>{item.userName}<br/><small>{item.userEmail}</small></td><td>{item.role}</td><td>{item.isActive ? "ACTIVE" : "INACTIVE"}</td><td><button className="secondary-button" type="button" onClick={() => toggle(item)}>{item.isActive ? "Nonaktifkan" : "Aktifkan"}</button></td></tr>)}
        {!aliases.length && <tr><td colSpan={6} className="muted">Belum ada alias.</td></tr>}
      </tbody></table>
    </ResponsiveTable>
  </section>;
}
