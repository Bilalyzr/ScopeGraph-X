"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("researcher@demo.test");
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
      <div>
        <form className="login-card" onSubmit={submit}>
          <div className="brand" style={{ paddingBottom: "1rem" }}>
            <span className="brand-mark">SX</span>
            <span style={{ fontSize: "1.15rem" }}>ScopeGraph X</span>
          </div>
          <h1 style={{ fontSize: "1.05rem", margin: "0 0 1rem" }}>
            {challengeToken ? "Enter your authenticator code" : "Sign in to the security workbench"}
          </h1>

          {!challengeToken ? (
            <>
              <label className="field">
                Email
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
              </label>
              <label className="field">
                Password
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
              </label>
            </>
          ) : (
            <>
              <p className="hint" style={{ marginBottom: "0.8rem" }}>Password accepted. Enter the 6-digit code from your authenticator app.</p>
              <label className="field">
                Authentication code
                <input inputMode="numeric" pattern="[0-9]*" maxLength={6} value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} required autoFocus autoComplete="one-time-code" />
              </label>
              <button type="button" className="btn small" style={{ marginBottom: "0.8rem" }} onClick={() => { setChallengeToken(null); setMfaCode(""); }}>
                ← Use a different account
              </button>
            </>
          )}

          {error && <div className="msg error" role="alert">{error}</div>}

          <button className="btn primary" style={{ width: "100%", justifyContent: "center" }} disabled={busy}>
            {busy ? "Verifying…" : challengeToken ? "Verify code" : "Sign in"}
          </button>

          <p className="hint" style={{ marginTop: "1rem" }}>
            Demo accounts (password <code className="inline">Demo1234!</code>): researcher@ · lead@ · owner@ · validator@ · admin@ · auditor@demo.test — and globex@demo.test to verify tenant isolation.
          </p>
          <p className="hint">Authorized security testing only. All active testing is policy-gated and simulated in this deployment.</p>
        </form>
      </div>
    </div>
  );
}
