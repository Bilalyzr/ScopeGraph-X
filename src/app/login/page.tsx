"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BackLink } from "@/components/BackLink";

const DEMO_ACCOUNTS = [
  { email: "researcher@demo.test", label: "Researcher" },
  { email: "lead@demo.test", label: "AppSec Lead" },
  { email: "owner@demo.test", label: "Program Owner" },
  { email: "validator@demo.test", label: "Validator" },
  { email: "admin@demo.test", label: "Tenant Admin" },
] as const;
const DEMO_PASSWORD = "Demo1234!";
const REMEMBERED_EMAIL_KEY = "sgx-last-email";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const mfaRef = useRef<HTMLInputElement>(null);
  const submittedRef = useRef(false);

  useEffect(() => {
    fetch("/api/auth/oidc/status").then((r) => r.json()).then((d) => setSsoEnabled(Boolean(d.enabled))).catch(() => {});
    // Remember the last successfully-used email (never the password).
    const last = localStorage.getItem(REMEMBERED_EMAIL_KEY);
    if (last) setEmail(last);
    else emailRef.current?.focus();
  }, []);

  useEffect(() => {
    if (challengeToken) mfaRef.current?.focus();
  }, [challengeToken]);

  async function completeLogin(body: { user: { id: string; email?: string }; active_org_id: string | null }) {
    try {
      localStorage.setItem(REMEMBERED_EMAIL_KEY, email.trim().toLowerCase());
    } catch {
      /* storage unavailable — non-fatal */
    }
    router.push(body.active_org_id ? "/dashboard" : "/onboarding");
    router.refresh();
  }

  async function verifyCode(code: string, token: string) {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login/mfa", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challenge_token: token, code }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.detail || body.title || "MFA verification failed");
        setMfaCode(""); // codes are single-use; make the user re-enter
        mfaRef.current?.focus();
        return;
      }
      await completeLogin(body);
    } finally {
      submittedRef.current = false;
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (challengeToken) {
      await verifyCode(mfaCode.replace(/\D/g, ""), challengeToken);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
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

  const errorId = error ? "login-error" : undefined;

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
                <span style={{ color: "var(--amber, #d9a441)" }}>[EGRESS_MODE]</span> simulated — no live target traffic
              </div>
              <div>
                <span style={{ color: "var(--mint)" }}>[AUDIT_LEDGER]</span> append-only SHA-256 hash chain verified
                <span className="terminal-cursor" />
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Authentication Card */}
        <form className="login-card card" style={{ marginBottom: 0 }} onSubmit={submit} noValidate>
          <BackLink href="/" label="Back to start" />
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
              <label className="field" htmlFor="login-email">
                Operator Email
                <input
                  id="login-email"
                  ref={emailRef}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="username"
                  placeholder="operator@organization.com"
                  aria-invalid={Boolean(error)}
                  aria-describedby={errorId}
                  disabled={busy}
                />
              </label>
              <label className="field" htmlFor="login-password">
                Password
                <span className="login-password-wrap">
                  <input
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyUp={(e) => setCapsLockOn(e.getModifierState?.("CapsLock") ?? false)}
                    onBlur={() => setCapsLockOn(false)}
                    required
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    aria-invalid={Boolean(error)}
                    aria-describedby={errorId ?? (capsLockOn ? "caps-lock-hint" : undefined)}
                    disabled={busy}
                  />
                  <button
                    type="button"
                    className="login-eye"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-pressed={showPassword}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    tabIndex={0}
                  >
                    {showPassword ? "🙈" : "👁"}
                  </button>
                </span>
              </label>
              {capsLockOn && (
                <p className="hint" id="caps-lock-hint" style={{ marginTop: "-0.45rem", color: "var(--amber, #d9a441)" }}>
                  ⚠ Caps Lock is on
                </p>
              )}

              <div className="login-demo-row" aria-label="Demo accounts">
                <span className="login-demo-label">DEMO ACCESS</span>
                {DEMO_ACCOUNTS.map((a) => (
                  <button
                    key={a.email}
                    type="button"
                    className="login-demo-chip"
                    onClick={() => {
                      setEmail(a.email);
                      setPassword(DEMO_PASSWORD);
                      setError(null);
                    }}
                    disabled={busy}
                    title={`Fill ${a.email}`}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="hint" style={{ marginBottom: "0.85rem" }}>
                Password accepted. Enter the 6-digit code from your TOTP authenticator app.
              </p>
              <label className="field" htmlFor="login-mfa">
                Authentication code (6-digit TOTP)
                <input
                  id="login-mfa"
                  ref={mfaRef}
                  className="login-mfa-input"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={mfaCode}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
                    setMfaCode(digits);
                    if (digits.length === 6 && challengeToken && !busy) {
                      void verifyCode(digits, challengeToken); // auto-verify on 6th digit
                    }
                  }}
                  required
                  autoComplete="one-time-code"
                  aria-invalid={Boolean(error)}
                  aria-describedby={errorId}
                  disabled={busy}
                />
              </label>
              <button
                type="button"
                className="btn small"
                style={{ marginBottom: "0.85rem" }}
                onClick={() => {
                  setChallengeToken(null);
                  setMfaCode("");
                  setError(null);
                }}
              >
                ← Use a different account
              </button>
            </>
          )}

          {error && (
            <div className="msg error login-error-shake" id={errorId} role="alert">
              {error}
            </div>
          )}

          <button className="btn primary" style={{ width: "100%", justifyContent: "center", marginTop: "0.4rem" }} disabled={busy}>
            {busy ? (
              <>
                <span className="login-spinner" aria-hidden="true" />
                VERIFYING…
              </>
            ) : challengeToken ? (
              "VERIFY TOTP CODE →"
            ) : (
              "AUTHENTICATE SESSION →"
            )}
          </button>

          {ssoEnabled && !challengeToken && (
            <>
              <div className="row" style={{ margin: "0.9rem 0 0.6rem", fontSize: "0.72rem", color: "var(--text-faint)", justifyContent: "center", gap: "0.7rem" }}>
                <span aria-hidden="true" style={{ flex: 1, borderTop: "1px solid var(--border)" }} /> OR CONTINUE WITH
                <span aria-hidden="true" style={{ flex: 1, borderTop: "1px solid var(--border)" }} />
              </div>
              <a className="btn" style={{ width: "100%", justifyContent: "center" }} href="/api/auth/oidc/login">
                Sign in with SSO (OIDC)
              </a>
            </>
          )}

          <p className="hint" style={{ marginTop: "1.2rem" }}>
            Authorized security testing only. All active operations require an approved scope policy version and verified asset ownership.
          </p>
        </form>
      </div>
    </div>
  );
}
