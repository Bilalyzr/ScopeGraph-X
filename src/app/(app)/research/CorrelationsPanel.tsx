"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ExternalRow {
  id: string; tool: string; rule: string; locator: string; cwe: string;
  severity: string; correlationStatus: string; correlatedFindingId: string | null;
}

export function CorrelationsPanel({ programs, rows }: { programs: Array<{ id: string; name: string }>; rows: ExternalRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [programId, setProgramId] = useState(programs[0]?.id ?? "");
  const [payload, setPayload] = useState("[]");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const findings = JSON.parse(payload);
      const res = await fetch("/api/v1/correlations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ program_id: programId, findings }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(`${data.code}: ${data.detail ?? data.title}`);
        return;
      }
      setResult(`Imported ${data.imported} external finding(s); ${data.correlated} linked to runtime findings — all left UNCONFIRMED for a validator.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid JSON");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="row spread">
        <h2>SAST/SCA ↔ runtime correlation ({rows.length})</h2>
        {programs.length > 0 && !open && (
          <button className="btn small" onClick={() => setOpen(true)}>⇪ Import static-analysis results</button>
        )}
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        Customer-supplied static results are linked to runtime findings by asset + rule overlap. Linking never confirms anything — pairs stay CORRELATED_UNCONFIRMED until a validator decides.
      </p>

      {open && (
        <form onSubmit={submit}>
          <label className="field">Program
            <select value={programId} onChange={(e) => setProgramId(e.target.value)}>
              {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="field">Findings JSON (<code className="inline">{"[{tool, rule, locator?, cwe?, severity?, asset_locator?}]"}</code>)
            <textarea rows={8} className="mono" value={payload} onChange={(e) => setPayload(e.target.value)} />
          </label>
          {error && <div className="msg error" role="alert">{error}</div>}
          {result && <div className="msg ok" role="status">{result}</div>}
          <div className="row">
            <button className="btn primary small" disabled={busy}>{busy ? "Importing…" : "Import batch"}</button>
            <button type="button" className="btn small" onClick={() => setOpen(false)}>Close</button>
          </div>
        </form>
      )}

      {rows.length > 0 && (
        <table className="data" style={{ marginTop: "0.6rem" }}>
          <thead><tr><th>Tool</th><th>Rule</th><th>Locator</th><th>CWE</th><th>Severity</th><th>Correlation</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><span className="badge neutral">{r.tool.toUpperCase()}</span></td>
                <td className="mono" style={{ fontSize: "0.75rem" }}>{r.rule}</td>
                <td className="mono" style={{ fontSize: "0.72rem" }}>{r.locator || "—"}</td>
                <td className="mono" style={{ fontSize: "0.72rem" }}>{r.cwe || "—"}</td>
                <td><span className={`badge sev-${r.severity}`}>{r.severity}</span></td>
                <td>
                  {r.correlatedFindingId ? (
                    <span className="badge accent">LINKED · UNCONFIRMED</span>
                  ) : (
                    <span className="badge neutral">uncorrelated</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
