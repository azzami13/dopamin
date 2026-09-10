"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type AccessRequest = { id: string; email: string; fullName: string; requestedAt: string };
type Role = { id: string; code: string; name: string };
export function AccessRequestManager({ requests, roles }: { requests: AccessRequest[]; roles: Role[] }) {
  const router = useRouter();
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function review(id: string, decision: 'APPROVED' | 'REJECTED') {
    if (busy) return;
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/settings/access-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, decision, ...(decision === 'APPROVED' ? { roleId: selection[id] } : {}) }) });
      const result = await response.json();
      if (!response.ok) { setMessage(result.error?.message ?? 'Permintaan belum dapat diproses.'); return; }
      setMessage(decision === 'APPROVED' ? 'Akses disetujui. User dapat masuk menggunakan Google.' : 'Permintaan akses ditolak.');
      router.refresh();
    } catch { setMessage('Permintaan belum dapat diproses.'); }
    finally { setBusy(false); }
  }
  return <section className="panel">
    <h2>Permintaan Akses Google</h2>
    <p className="muted">Pilih role sebelum menyetujui akses. Persetujuan membuat akun tanpa password.</p>
    {message && <p role="status">{message}</p>}
    {!requests.length && <p>Belum ada permintaan yang menunggu persetujuan.</p>}
    {requests.map(request => <div className="panel form-stack" key={request.id}>
      <strong>{request.fullName}</strong><span>{request.email}</span>
      <span className="muted">Diminta: {new Date(request.requestedAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB</span>
      <label>Role untuk {request.email}<select value={selection[request.id] ?? ''} disabled={busy}
        onChange={event => setSelection({ ...selection, [request.id]: event.target.value })}>
        <option value="">Pilih role</option>
        {roles.map(role => <option value={role.id} key={role.id}>{role.name} ({role.code})</option>)}
      </select></label>
      <button type="button" className="primary-button" disabled={busy || !selection[request.id]} onClick={() => review(request.id, 'APPROVED')}>Setujui</button>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => review(request.id, 'REJECTED')}>Tolak</button>
    </div>)}
  </section>;
}
