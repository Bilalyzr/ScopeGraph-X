"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CreateProgramForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", handle: "", authorization_ref: "", description: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/programs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, provider: "manual" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(`${data.code}: ${data.detail ?? data.title}`);
        return;
      }
      setOpen(false);
      setForm({ name: "", handle: "", authorization_ref: "", description: "" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="row" style={{ marginBottom: "1rem" }}>
        <button className="btn primary" onClick={() => setOpen(true)}>+ Create program</button>
      </div>
    );
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>New program</h2>
      <div className="form-row">
        <label className="field">Name
          <input required minLength={3} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Retail Platform Q4" />
        </label>
        <label className="field">Handle (slug)
          <input required pattern="[a-z0-9-]+" value={form.handle} onChange={(e) => setForm({ ...form, handle: e.target.value })} placeholder="retail-q4" />
        </label>
      </div>
      <label className="field">Authorization reference (contract / policy URL / doc ID)
        <input required minLength={3} value={form.authorization_ref} onChange={(e) => setForm({ ...form, authorization_ref: e.target.value })} placeholder="engagement-contract-2026-…" />
      </label>
      <label className="field">Description
        <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </label>
      {error && <div className="msg error" role="alert">{error}</div>}
      <div className="row">
        <button className="btn primary" disabled={busy}>{busy ? "Creating…" : "Create program"}</button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
