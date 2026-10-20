"use client";

import { useCallback, useEffect, useState } from "react";

interface EndpointRow { id: string; url: string; events: string[]; active: boolean }
interface DeliveryRow { id: string; event: string; status: string; attempts: number; last_response: string | null }

export function WebhooksPanel() {
  const [data, setData] = useState<{ transport: string; available_events: string[]; endpoints: EndpointRow[]; recent_deliveries: DeliveryRow[] } | null>(null);
  const [url, setUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>(["finding.status_changed"]);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/v1/webhooks");
    if (res.ok) setData(await res.json());
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSecret(null);
    try {
      const res = await fetch("/api/v1/webhooks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, events: selectedEvents }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(`${body.code}: ${body.detail ?? body.title}`);
        return;
      }
      setSecret(body.secret_shown_once);
      setUrl("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function toggle(id: string, active: boolean) {
    await fetch("/api/v1/webhooks", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, active }),
    });
    await load();
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this webhook endpoint? Pending deliveries are dead-lettered.")) return;
    await fetch(`/api/v1/webhooks?id=${id}`, { method: "DELETE" });
    await load();
  }

  async function drain() {
    await fetch("/api/v1/webhooks", { method: "PUT" });
    await load();
  }

  return (
    <div className="card">
      <div className="row spread">
        <h2>Webhooks (signed outbound events)</h2>
        <button className="btn small" onClick={drain}>Process pending deliveries now</button>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        Transport: <strong>{data?.transport ?? "…"}</strong>. Payloads are HMAC-SHA256 signed over
        <code className="inline"> timestampMs.nonce.body</code> (headers <code className="inline">x-sgx-signature/timestamp/nonce</code>); receivers should reject &gt;5 min skew. Failed deliveries retry with backoff up to 5 attempts, then dead-letter.
      </p>

      <form onSubmit={create} className="row" style={{ alignItems: "flex-end" }}>
        <label className="field" style={{ flex: 1, margin: 0 }}>
          Endpoint URL
          <input type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.test/hooks/scopegraph" />
        </label>
        <button className="btn primary" disabled={busy || selectedEvents.length === 0}>{busy ? "…" : "Add endpoint"}</button>
      </form>
      <div className="row" style={{ margin: "0.5rem 0" }}>
        {(data?.available_events ?? []).map((ev) => (
          <label key={ev} className="row" style={{ fontSize: "0.78rem", gap: 4 }}>
            <input
              type="checkbox"
              style={{ width: "auto" }}
              checked={selectedEvents.includes(ev)}
              onChange={(e) =>
                setSelectedEvents(e.target.checked ? [...selectedEvents, ev] : selectedEvents.filter((x) => x !== ev))
              }
            />
            {ev}
          </label>
        ))}
      </div>
      {error && <div className="msg error" role="alert">{error}</div>}
      {secret && (
        <div className="msg ok" role="status">
          Signing secret (shown once — store it now): <code className="inline mono">{secret}</code>
        </div>
      )}

      {data && data.endpoints.length > 0 && (
        <table className="data" style={{ marginTop: "0.6rem" }}>
          <thead><tr><th>URL</th><th>Events</th><th>State</th><th></th></tr></thead>
          <tbody>
            {data.endpoints.map((ep) => (
              <tr key={ep.id}>
                <td className="mono" style={{ fontSize: "0.75rem" }}>{ep.url}</td>
                <td className="mono" style={{ fontSize: "0.7rem" }}>{ep.events.join(", ")}</td>
                <td><span className={`badge ${ep.active ? "ok" : "neutral"}`}>{ep.active ? "active" : "disabled"}</span></td>
                <td>
                  <div className="row">
                    <button className="btn small" onClick={() => toggle(ep.id, !ep.active)}>{ep.active ? "Disable" : "Enable"}</button>
                    <button className="btn small danger" onClick={() => remove(ep.id)}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {data && data.recent_deliveries.length > 0 && (
        <>
          <h3 style={{ fontSize: "0.8rem", margin: "1rem 0 0.4rem", color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Recent deliveries</h3>
          <table className="data">
            <thead><tr><th>Event</th><th>Status</th><th>Attempts</th><th>Response</th></tr></thead>
            <tbody>
              {data.recent_deliveries.map((d) => (
                <tr key={d.id}>
                  <td className="mono" style={{ fontSize: "0.72rem" }}>{d.event}</td>
                  <td><span className={`badge ${d.status === "DELIVERED" ? "ok" : d.status === "DEAD" ? "danger" : "info"}`}>{d.status}</span></td>
                  <td>{d.attempts}</td>
                  <td className="mono faint" style={{ fontSize: "0.7rem" }}>{d.last_response ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
