"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ResourceRow {
  id: string; objectType: string; fixtureRef: string | null;
  machine: { initialState: string; transitions: Array<{ from: string; to: string }>; idempotentOperations?: string[] };
}

export function InvariantPanel({ resources, canRun }: { resources: ResourceRow[]; canRun: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; text: string; ok: boolean } | null>(null);

  async function run(resourceId: string) {
    setBusy(resourceId);
    setResult(null);
    try {
      const res = await fetch(`/api/v1/resources/${resourceId}:check`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult({ id: resourceId, text: `${data.code}: ${data.detail ?? data.title}`, ok: false });
        return;
      }
      setResult({
        id: resourceId,
        text: data.status === "VIOLATIONS_FOUND"
          ? `${data.violations.length} violation(s) — candidate finding ${data.finding_id ?? "created"} (evidence ${data.evidence_id})`
          : `No violations — all recorded transitions conform to the approved machine (evidence ${data.evidence_id})`,
        ok: data.status !== "VIOLATIONS_FOUND",
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card">
      <h2>Business workflow invariants ({resources.length})</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        Analyst-approved state machines replayed against recorded fixture transitions. Non-idempotent operations and illegal transitions produce CANDIDATE findings (fixture-only, simulated).
      </p>
      {resources.length === 0 ? (
        <p className="empty">No workflow resources defined.</p>
      ) : (
        <table className="data">
          <thead><tr><th>Resource</th><th>Fixture</th><th>Approved machine</th><th>Idempotent ops</th><th></th></tr></thead>
          <tbody>
            {resources.map((r) => (
              <tr key={r.id}>
                <td className="mono" style={{ fontSize: "0.75rem" }}>{r.objectType}<div className="faint">{r.id}</div></td>
                <td className="mono" style={{ fontSize: "0.72rem" }}>{r.fixtureRef ?? "—"}</td>
                <td className="mono" style={{ fontSize: "0.72rem" }}>
                  {r.machine.transitions.map((t, i) => <span key={i}>{i > 0 && " · "}{t.from}→{t.to}</span>)}
                </td>
                <td className="mono" style={{ fontSize: "0.72rem" }}>{r.machine.idempotentOperations?.join(", ") || "—"}</td>
                <td>
                  {canRun && (
                    <button className="btn small primary" onClick={() => run(r.id)} disabled={busy !== null}>
                      {busy === r.id ? "…" : "Run check"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {result && (
        <div className={`msg ${result.ok ? "ok" : "error"}`} role="status">{result.text}</div>
      )}
    </div>
  );
}
