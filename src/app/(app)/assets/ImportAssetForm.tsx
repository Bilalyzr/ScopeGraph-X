"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ImportAssetForm({ programs }: { programs: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ program_id: programs[0]?.id ?? "", canonical_locator: "", asset_type: "HOST", note: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/assets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(`${data.code}: ${data.detail ?? data.title}`);
        return;
      }
      setOpen(false);
      setForm({ ...form, canonical_locator: "", note: "" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (programs.length === 0) return null;

  if (!open) {
    return <button className="btn" style={{ marginBottom: "0.9rem" }} onClick={() => setOpen(true)}>+ Import asset manually</button>;
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>Manual asset import</h2>
      <div className="form-row">
        <label className="field">Program
          <select value={form.program_id} onChange={(e) => setForm({ ...form, program_id: e.target.value })}>
            {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="field">Canonical locator (host/domain)
          <input required minLength={3} value={form.canonical_locator} onChange={(e) => setForm({ ...form, canonical_locator: e.target.value })} placeholder="staging.demo-target.test" />
        </label>
      </div>
      <div className="form-row">
        <label className="field">Type
          <select value={form.asset_type} onChange={(e) => setForm({ ...form, asset_type: e.target.value })}>
            {["HOST", "DOMAIN", "IP", "WEB_APP", "API", "CLOUD_CONFIG"].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="field">Note
          <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="source of this import" />
        </label>
      </div>
      {error && <div className="msg error" role="alert">{error}</div>}
      <div className="row">
        <button className="btn primary" disabled={busy}>{busy ? "Importing…" : "Import (enters as DISCOVERED)"}</button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      <p className="hint">Imported assets start DISCOVERED — active testing requires the audited ownership→authorization ladder.</p>
    </form>
  );
}
