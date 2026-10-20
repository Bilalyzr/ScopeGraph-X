"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function FindingActions({
  findingId,
  allowedNext,
  isValidator,
}: {
  findingId: string;
  allowedNext: string[];
  isValidator: boolean;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [validation, setValidation] = useState({ outcome: "VALIDATED", notes: "" });

  async function transition(to: string) {
    setBusy(to);
    setError(null);
    try {
      const res = await fetch(`/api/v1/findings/${findingId}:review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to, reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(`${data.code}: ${Array.isArray(data.allowed) ? `allowed: ${data.allowed.join(", ")}` : data.detail ?? data.title}`);
        return;
      }
      setReason("");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function validate() {
    setBusy("validate");
    setError(null);
    try {
      const res = await fetch(`/api/v1/findings/${findingId}:validate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validation),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(`${data.code}: ${data.detail ?? data.title}`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <label className="field">Reason (recorded in the audit trail)
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this decision?" />
      </label>
      <div className="row">
        {allowedNext.map((s) => (
          <button
            key={s}
            className={`btn small ${s === "REJECTED" || s === "FALSE_POSITIVE" ? "" : "primary"}`}
            disabled={busy !== null}
            onClick={() => transition(s)}
          >
            {busy === s ? "…" : `→ ${s.replace("_", " ")}`}
          </button>
        ))}
      </div>

      {isValidator && (
        <div style={{ borderTop: "1px solid var(--border)", marginTop: "0.9rem", paddingTop: "0.9rem" }}>
          <h2 style={{ fontSize: "0.9rem" }}>Independent validation decision</h2>
          <label className="field">Outcome
            <select value={validation.outcome} onChange={(e) => setValidation({ ...validation, outcome: e.target.value })}>
              <option value="VALIDATED">VALIDATED — reproduced independently</option>
              <option value="UNVALIDATED">UNVALIDATED — pending</option>
              <option value="REFUTED">REFUTED — evidence does not support the claim</option>
            </select>
          </label>
          <label className="field">Notes
            <input value={validation.notes} onChange={(e) => setValidation({ ...validation, notes: e.target.value })} placeholder="Reproduction summary / objections" />
          </label>
          <button className="btn small primary" disabled={busy !== null || validation.notes.length < 3} onClick={validate}>
            {busy === "validate" ? "…" : "Record validation"}
          </button>
          <p className="hint">A finding can only move to REPORTED after a VALIDATED decision.</p>
        </div>
      )}

      {error && <div className="msg error" role="alert">{error}</div>}
    </div>
  );
}
