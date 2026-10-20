"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const DEFAULT_RULES = {
  allow: [],
  deny: [],
  budgets: { max_requests: 500, max_rps: 2, max_concurrency: 2 },
  notes: "",
};

export function ProposeScopeForm({ programId }: { programId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [json, setJson] = useState(JSON.stringify(DEFAULT_RULES, null, 2));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let rules: unknown;
      try {
        rules = JSON.parse(json);
      } catch {
        throw new Error("Rules are not valid JSON");
      }
      const res = await fetch(`/api/v1/programs/${programId}/scope-versions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rules, note, provenance: "ui" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(`${data.code}: ${data.detail ?? data.title}`);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div>
        <h2>Scope policy compiler</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          Draft a new versioned allow/deny/budget rule set. Requires separate human approval before activation.
        </p>
        <button className="btn primary" onClick={() => setOpen(true)}>+ Propose scope version</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <h2>Propose new scope version</h2>
      <label className="field">Note
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <label className="field">Rules (JSON — allow/deny/budgets; deny overrides allow)
        <textarea rows={12} value={json} onChange={(e) => setJson(e.target.value)} className="mono" />
      </label>
      {error && <div className="msg error" role="alert">{error}</div>}
      <div className="row">
        <button className="btn primary" disabled={busy}>{busy ? "Proposing…" : "Propose version"}</button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
