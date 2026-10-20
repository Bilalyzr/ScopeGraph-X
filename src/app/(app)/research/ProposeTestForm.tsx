"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ProposeTestForm({
  hypothesisId,
  hypotheses,
}: {
  hypothesisId: string;
  hypotheses?: Array<{ id: string; category: string; summary: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selectedHypId, setSelectedHypId] = useState(hypothesisId);
  const [form, setForm] = useState({ target_host: "", target_path: "/", method: "GET", identities: "", oracle_id: "differential-auth-matrix" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/hypotheses/${selectedHypId}/tests`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...form,
          identities: form.identities.split(",").map((s) => s.trim()).filter(Boolean),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(`${data.code}: ${data.detail ?? data.title}`);
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return <button className="btn" style={{ marginTop: "0.5rem" }} onClick={() => setOpen(true)}>+ Propose test for latest hypothesis</button>;
  }

  return (
    <form onSubmit={submit} style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem", marginTop: "1rem" }}>
      <h2 style={{ fontSize: "0.95rem" }}>Propose bounded test plan</h2>
      {hypotheses && hypotheses.length > 0 && (
        <label className="field">Target Hypothesis
          <select value={selectedHypId} onChange={(e) => setSelectedHypId(e.target.value)}>
            {hypotheses.map((h) => (
              <option key={h.id} value={h.id}>
                [{h.category}] {h.summary.slice(0, 72)} ({h.id})
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="form-row">
        <label className="field">Target host
          <input value={form.target_host} onChange={(e) => setForm({ ...form, target_host: e.target.value })} />
        </label>
        <label className="field">Path
          <input value={form.target_path} onChange={(e) => setForm({ ...form, target_path: e.target.value })} />
        </label>
      </div>
      <div className="form-row">
        <label className="field">Method
          <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
            {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => <option key={m}>{m}</option>)}
          </select>
        </label>
        <label className="field">Provisioned identities (comma separated)
          <input value={form.identities} onChange={(e) => setForm({ ...form, identities: e.target.value })} />
        </label>
      </div>
      {error && <div className="msg error" role="alert">{error}</div>}
      <div className="row">
        <button className="btn primary" disabled={busy}>{busy ? "Proposing…" : "Propose test"}</button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      <p className="hint">The plan still requires separate approval and passes the deterministic policy gateway before any (simulated) execution.</p>
    </form>
  );
}
