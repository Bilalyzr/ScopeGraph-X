"use client";

import { useCallback, useEffect, useState } from "react";

interface SessionRow {
  id: string;
  current: boolean;
  created_at: string;
  expires_at: string;
  revoked: boolean;
}

export default function SessionsSection() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/auth/sessions");
    if (res.ok) {
      const data = await res.json();
      setSessions(data.data);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function revokeOthers() {
    setBusy(true);
    try {
      const res = await fetch("/api/auth/sessions", { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      setMsg(res.ok ? `Revoked ${data.revoked} other session(s).` : "Failed to revoke sessions.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="row spread">
        <h2>Active sessions</h2>
        <button className="btn small danger" onClick={revokeOthers} disabled={busy}>
          Revoke all other sessions
        </button>
      </div>
      {msg && <div className="msg ok" role="status">{msg}</div>}
      <table className="data">
        <thead>
          <tr><th>Session</th><th>Status</th><th>Created</th><th>Expires</th></tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id}>
              <td className="mono">{s.id}</td>
              <td>
                {s.current ? <span className="badge ok">current</span> : null}{" "}
                {s.revoked ? <span className="badge neutral">revoked</span> : <span className="badge info">active</span>}
              </td>
              <td className="faint" style={{ fontSize: "0.75rem" }}>{new Date(s.created_at).toISOString().slice(0, 16).replace("T", " ")}</td>
              <td className="faint" style={{ fontSize: "0.75rem" }}>{new Date(s.expires_at).toISOString().slice(0, 16).replace("T", " ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
