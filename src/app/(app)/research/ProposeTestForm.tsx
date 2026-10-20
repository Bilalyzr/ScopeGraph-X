"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ProposeTestForm({ hypothesisId }: { hypothesisId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ target_host: "api.demo-target.test", target_path: "/v1/orders/ord_1001", method: "GET", identities: "idt_support, idt_billing", oracle_id: "differential-auth-matrix" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/hypotheses/${hypothesisId}/tests`, {
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
