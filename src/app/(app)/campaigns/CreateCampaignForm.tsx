"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CreateCampaignForm({
  programs,
  policies,
}: {
  programs: Array<{ id: string; name: string }>;
  policies: Array<{ id: string; programId: string; version: number }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    program_id: programs[0]?.id ?? "",
    mode: "PASSIVE_ONLY",
    max_requests: 200,
    max_rps: 1,
    max_concurrency: 1,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const activePolicy = policies.find((p) => p.programId === form.program_id);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!activePolicy) {
      setError("Selected program has no ACTIVE policy version — activate one first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": `ui-${Date.now()}` },
        body: JSON.stringify({
          program_id: form.program_id,
          policy_version_id: activePolicy.id,
          name: form.name,
          mode: form.mode,
          budget: { max_requests: Number(form.max_requests), max_rps: Number(form.max_rps), max_concurrency: Number(form.max_concurrency) },
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

  if (programs.length === 0) {
    return <p className="empty">Create a program with an active policy before running campaigns.</p>;
  }

  if (!open) {
    return <button className="btn primary" style={{ marginBottom: "1rem" }} onClick={() => setOpen(true)}>+ New campaign</button>;
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>New campaign</h2>
      <div className="form-row">
        <label className="field">Name
          <input required minLength={3} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Q4 passive sweep" />
        </label>
        <label className="field">Program (active policy pinned automatically)
          <select value={form.program_id} onChange={(e) => setForm({ ...form, program_id: e.target.value })}>
            {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </div>
      <div className="form-row">
        <label className="field">Mode
          <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
            <option value="PASSIVE_ONLY">Passive only (no active requests)</option>
            <option value="PASSIVE_THEN_APPROVED_ACTIVE">Passive + approved active (policy-gated, simulated)</option>
          </select>
        </label>
        <label className="field">Budget
          <div className="row">
            <input type="number" min={1} value={form.max_requests} onChange={(e) => setForm({ ...form, max_requests: Number(e.target.value) })} aria-label="max requests" />
            <input type="number" min={0.5} step={0.5} value={form.max_rps} onChange={(e) => setForm({ ...form, max_rps: Number(e.target.value) })} aria-label="max rps" />
            <input type="number" min={1} value={form.max_concurrency} onChange={(e) => setForm({ ...form, max_concurrency: Number(e.target.value) })} aria-label="max concurrency" />
          </div>
          <div className="hint">requests · requests/sec · concurrency</div>
        </label>
      </div>
      {!activePolicy && <div className="msg error">This program has no ACTIVE policy version.</div>}
      {error && <div className="msg error" role="alert">{error}</div>}
      <div className="row">
        <button className="btn primary" disabled={busy}>{busy ? "Creating…" : "Create campaign (draft)"}</button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
