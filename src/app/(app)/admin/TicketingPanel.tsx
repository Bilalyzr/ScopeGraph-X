"use client";

import { useEffect, useState } from "react";

interface TicketRow { findingId: string; system: string; issueKey: string; issueUrl: string; createdAt: string }

export function TicketingPanel() {
  const [data, setData] = useState<{ mode: string; tickets: TicketRow[] } | null>(null);

  useEffect(() => {
    fetch("/api/v1/ticketing").then((r) => (r.ok ? r.json() : null)).then(setData);
  }, []);

  return (
    <div className="card">
      <h2>Ticketing sync (Jira-style)</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        When a finding transitions to <strong>REPORTED</strong>, a tracker ticket is created and linked (idempotent — one
        ticket per finding). Mode: <strong>{data?.mode ?? "…"}</strong>. <code className="inline">none</code> = no sync ·{" "}
        <code className="inline">recorder</code> = payloads recorded, no network · <code className="inline">jira</code> = Jira Cloud REST
        (set <code className="inline">TICKETING_PROVIDER=jira JIRA_BASE_URL JIRA_EMAIL JIRA_API_TOKEN JIRA_PROJECT_KEY</code>).
      </p>
      {data && data.tickets.length > 0 ? (
        <table className="data">
          <thead><tr><th>Issue</th><th>System</th><th>Finding</th><th>Created</th></tr></thead>
          <tbody>
            {data.tickets.map((t) => (
              <tr key={t.findingId}>
                <td className="mono">{t.issueUrl ? <a href={t.issueUrl} target="_blank" rel="noreferrer">{t.issueKey}</a> : t.issueKey}</td>
                <td>{t.system}</td>
                <td className="mono" style={{ fontSize: "0.72rem" }}>{t.findingId}</td>
                <td className="faint" style={{ fontSize: "0.72rem" }}>{new Date(t.createdAt).toISOString().slice(0, 16).replace("T", " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty">No tickets linked yet — transition a validated finding to REPORTED with ticketing enabled.</p>
      )}
    </div>
  );
}
