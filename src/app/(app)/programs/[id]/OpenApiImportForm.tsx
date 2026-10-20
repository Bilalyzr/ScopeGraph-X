"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const SAMPLE = JSON.stringify(
  {
    openapi: "3.1.0",
    info: { title: "demo-orders-api", version: "1.4.0" },
    paths: {
      "/v1/orders": { get: { operationId: "listOrders" }, post: { operationId: "createOrder" } },
      "/v1/orders/{id}": { get: { operationId: "getOrder" } },
      "/v1/admin/export": { post: { operationId: "exportAll" } },
    },
  },
  null,
  2
);

export function OpenApiImportForm({ programId, assets }: { programId: string; assets: Array<{ id: string; locator: string }> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [assetId, setAssetId] = useState(assets[0]?.id ?? "");
  const [doc, setDoc] = useState(SAMPLE);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const document = JSON.parse(doc);
      const res = await fetch(`/api/v1/programs/${programId}/imports/openapi`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ asset_id: assetId, document }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(`${data.code}: ${data.detail ?? data.title}`);
        return;
      }
      setResult(`Imported "${data.title}" — ${data.endpoints_created} new endpoints (${data.duplicates} duplicates), ${data.change_events} change event(s)`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid JSON");
    } finally {
      setBusy(false);
    }
  }

  if (assets.length === 0) return null;

  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem", marginTop: "0.5rem" }}>
      {!open ? (
        <button className="btn" onClick={() => setOpen(true)}>⇪ Import OpenAPI schema (endpoints)</button>
      ) : (
        <form onSubmit={submit}>
          <h2 style={{ fontSize: "0.95rem" }}>Import OpenAPI / Swagger document</h2>
          <label className="field">Target asset
            <select value={assetId} onChange={(e) => setAssetId(e.target.value)}>
              {assets.map((a) => <option key={a.id} value={a.id}>{a.locator}</option>)}
            </select>
          </label>
          <label className="field">Document (JSON)
            <textarea rows={12} className="mono" value={doc} onChange={(e) => setDoc(e.target.value)} />
          </label>
          {error && <div className="msg error" role="alert">{error}</div>}
          {result && <div className="msg ok" role="status">{result}</div>}
          <div className="row">
            <button className="btn primary" disabled={busy}>{busy ? "Importing…" : "Import & normalize"}</button>
            <button type="button" className="btn" onClick={() => setOpen(false)}>Close</button>
          </div>
          <p className="hint">Parsing is local — nothing is fetched. New routes become endpoints and surface in the change feed as NEW_ENDPOINT events.</p>
        </form>
      )}
    </div>
  );
}
