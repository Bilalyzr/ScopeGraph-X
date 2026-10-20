"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function completeLogin(body: { user: { id: string }; active_org_id: string | null }) {
    router.push(body.active_org_id ? "/dashboard" : "/onboarding");
    router.refresh();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Step 2: MFA challenge response
      if (challengeToken) {
        const res = await fetch("/api/auth/login/mfa", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ challenge_token: challengeToken, code: mfaCode }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(body.detail || body.title || "MFA verification failed");
          return;
        }
        await completeLogin(body);
        return;
      }

      // Step 1: password
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.detail || body.title || "Sign-in failed");
        return;
      }
      if (body.mfa_required) {
        setChallengeToken(body.challenge_token);
        return;
      }
      await completeLogin(body);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-shell">
        {/* Editorial Left Column: Press + Signal Instrument Brief */}
        <div className="card" style={{ marginBottom: 0, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <div className="brand" style={{ paddingTop: 0 }}>
              <span className="brand-mark">SX</span>
              <div className="brand-title">
                <span className="brand-name">ScopeGraph X</span>
                <span className="brand-sub">Editorial Security Instrument</span>
              </div>
            </div>

            <div className="section-label" style={{ marginTop: "0.75rem" }}>
              <span className="section-label-num">01</span>
              <span>SCOPE-CONTROLLED WORKBENCH</span>
            </div>

            <h1 style={{ fontSize: "2.1rem", margin: "0.4rem 0 0.75rem" }}>
              Authorized discovery &amp; policy-gated verification.
            </h1>
            <p className="muted" style={{ margin: "0 0 1.2rem" }}>
              Every outbound probe traverses a deterministic policy gateway, segregation-of-duties approval ladder, and SHA-256 hash-chained audit ledger.
            </p>
          </div>

          <div className="terminal-panel" style={{ marginBottom: 0 }}>
            <div className="terminal-header">
              <span className="terminal-dots" aria-hidden="true">
                <span className="terminal-dot coral" />
                <span className="terminal-dot amber" />
                <span className="terminal-dot mint" />
              </span>
              <span className="terminal-title">gateway.posture // status</span>
            </div>
            <div style={{ color: "#cfd8cd", fontSize: "0.74rem", lineHeight: 1.65 }}>
              <div>
                <span style={{ color: "var(--mint)" }}>[POLICY_GATEWAY]</span> default-deny scope enforcement active
              </div>
              <div>
                <span style={{ color: "var(--coral)" }}>[APPROVAL_LADDER]</span> dual-control segregation of duties
              </div>
              <div>
                <span style={{ color: "var(--mint)" }}>[AUDIT_LEDGER]</span> append-only SHA-256 hash chain verified
                <span className="terminal-cursor" />
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Authentication Card */}
        <form className="login-card card" style={{ marginBottom: 0 }} onSubmit={submit}>
          <div className="pulse-strip" style={{ marginBottom: "1.1rem" }}>
            <span className="pulse-strip-label">
              <span className="signal-dot" />
              {challengeToken ? "STEP 02 // TOTP CHALLENGE" : "STEP 01 // OPERATOR AUTH"}
            </span>
            <svg className="ecg-svg" width="84" height="20" viewBox="0 0 88 22" aria-hidden="true">
              <polyline
                className="ecg-line"
                points="0,12 18,12 24,12 28,4 33,19 38,2 43,16 47,10 52,12 88,12"
              />
            </svg>
          </div>

          <h2 style={{ fontSize: "1.25rem", margin: "0 0 1.1rem" }}>
            {challengeToken ? "Enter your authenticator code" : "Sign in to the security workbench"}
          </h2>

          {!challengeToken ? (
            <>
              <label className="field">
                Operator Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="username"
                  placeholder="operator@organization.com"
                />
              </label>
              <label className="field">
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="Enter your password"
                />
              </label>
            </>
          ) : (
            <>
              <p className="hint" style={{ marginBottom: "0.85rem" }}>
                Password accepted. Enter the 6-digit code from your TOTP authenticator app.
              </p>
              <label className="field">
                Authentication code (6-digit TOTP)
                <input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  required
                  autoFocus
                  autoComplete="one-time-code"
                />
              </label>
              <button
                type="button"
                className="btn small"
                style={{ marginBottom: "0.85rem" }}
                onClick={() => {
                  setChallengeToken(null);
                  setMfaCode("");
                }}
              >
                ← Use a different account
              </button>
            </>
          )}

          {error && (
            <div className="msg error" role="alert">
              {error}
            </div>
          )}

          <button className="btn primary" style={{ width: "100%", justifyContent: "center", marginTop: "0.4rem" }} disabled={busy}>
            {busy ? "VERIFYING…" : challengeToken ? "VERIFY TOTP CODE →" : "AUTHENTICATE SESSION →"}
          </button>

          <p className="hint" style={{ marginTop: "1.2rem" }}>
            Authorized security testing only. All active operations require an approved scope policy version and verified asset ownership.
          </p>
        </form>
      </div>
    </div>
  );
}
