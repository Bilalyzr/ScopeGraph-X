"use client";

import { useState } from "react";

export default function MfaSection() {
  const [state, setState] = useState<"idle" | "enrolling" | "enabled-unknown">("enabled-unknown");
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauth, setOtpauth] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function startEnroll() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/auth/mfa", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ kind: "error", text: `${data.code}: ${data.detail ?? data.title}` });
        return;
      }
      setSecret(data.secret);
      setOtpauth(data.otpauth_uri);
      setState("enrolling");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/auth/mfa", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ kind: "error", text: `${data.code}: ${data.detail ?? data.title}` });
        return;
      }
      setState("idle");
      setSecret(null);
      setMsg({ kind: "ok", text: "MFA is now enabled on this account. You will be asked for a code at every sign-in." });
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/auth/mfa", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ kind: "error", text: `${data.code}: ${data.detail ?? data.title}` });
        return;
      }
      setPassword("");
      setMsg({ kind: "ok", text: "MFA disabled." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Multi-factor authentication (TOTP)</h2>
      {state === "enrolling" && secret ? (
        <div>
          <p className="hint" style={{ marginTop: 0 }}>
            1. Add this secret to your authenticator app (manual entry — the otpauth URI below can also be imported):
          </p>
          <p className="mono" style={{ background: "var(--bg-overlay)", padding: "0.6rem", borderRadius: 6, wordBreak: "break-all" }}>{secret}</p>
          <p className="mono faint" style={{ fontSize: "0.7rem", wordBreak: "break-all" }}>{otpauth}</p>
          <label className="field">2. Enter the current 6-digit code to confirm
            <input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
          </label>
          <button className="btn primary" onClick={confirm} disabled={busy || code.length !== 6}>
            {busy ? "Verifying…" : "Confirm & enable"}
          </button>
        </div>
      ) : (
        <div>
          <p className="hint" style={{ marginTop: 0 }}>
            TOTP second factor (RFC 6238). Secrets are stored encrypted; enabling requires a valid code.
          </p>
          <button className="btn primary" onClick={startEnroll} disabled={busy}>
            {busy ? "…" : "Enroll authenticator"}
          </button>
          <div style={{ borderTop: "1px solid var(--border)", marginTop: "1rem", paddingTop: "1rem" }}>
            <h3 style={{ fontSize: "0.85rem", margin: "0 0 0.5rem" }}>Disable MFA</h3>
            <label className="field">Confirm with account password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </label>
            <button className="btn danger" onClick={disable} disabled={busy || password.length === 0}>Disable MFA</button>
          </div>
        </div>
      )}
      {msg && <div className={`msg ${msg.kind}`} role="alert">{msg.text}</div>}
    </div>
  );
}
