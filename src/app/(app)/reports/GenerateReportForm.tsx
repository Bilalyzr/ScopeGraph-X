"use client";

import { useState } from "react";

export function GenerateReportForm({ programs }: { programs: Array<{ id: string; name: string }> }) {
  const [programId, setProgramId] = useState(programs[0]?.id ?? "");
  const [format, setFormat] = useState<"json" | "html" | "pdf">("json");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ program_id: programId, format }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(`${data.code}: ${data.detail ?? data.title}`);
        return;
      }
      if (format === "json") {
        const data = await res.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        downloadBlob(blob, `scopegraph-report-${data.id}.json`);
      } else {
        const blob = await res.blob();
        downloadBlob(blob, `scopegraph-report.${format}`);
      }
    } finally {
      setBusy(false);
    }
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (programs.length === 0) return <p className="empty">No programs available.</p>;

  return (
    <div className="card">
      <h2>Generate report</h2>
      <div className="row">
        <select value={programId} onChange={(e) => setProgramId(e.target.value)} style={{ maxWidth: 280 }} aria-label="Program">
          {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={format} onChange={(e) => setFormat(e.target.value as typeof format)} style={{ maxWidth: 140 }} aria-label="Format">
          <option value="json">JSON</option>
          <option value="html">HTML</option>
          <option value="pdf">PDF</option>
        </select>
        <button className="btn primary" onClick={generate} disabled={busy}>
          {busy ? "Generating…" : "Generate & download"}
        </button>
      </div>
      {error && <div className="msg error" role="alert">{error}</div>}
    </div>
  );
}
