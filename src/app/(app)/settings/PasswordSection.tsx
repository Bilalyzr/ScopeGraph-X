"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function PasswordSection() {
  const router = useRouter();
  const [form, setForm] = useState({ current_password: "", new_password: "", confirm: "", mfa_code: "" });
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.new_password !== form.confirm) {
      setMsg({ kind: "error", text: "New passwords do not match" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          current_password: form.current_password,
          new_password: form.new_password,
          mfa_code: form.mfa_code || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ kind: "error", text: `${data.code}: ${data.detail ?? data.title}` });
        return;
      }
      setMsg({ kind: "ok", text: "Password changed. All sessions were revoked — signing you out…" });
      setTimeout(() => router.push("/login"), 1500);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>Change password</h2>
      <label className="field">Current password
        <input type="password" required value={form.current_password} onChange={(e) => setForm({ ...form, current_password: e.target.value })} autoComplete="current-password" />
      </label>
      <label className="field">New password (10+ chars, letters + digits)
        <input type="password" required minLength={10} value={form.new_password} onChange={(e) => setForm({ ...form, new_password: e.target.value })} autoComplete="new-password" />
      </label>
      <label className="field">Confirm new password
        <input type="password" required value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} autoComplete="new-password" />
      </label>
      <label className="field">MFA code (if enabled)
        <input inputMode="numeric" maxLength={6} value={form.mfa_code} onChange={(e) => setForm({ ...form, mfa_code: e.target.value })} autoComplete="one-time-code" />
      </label>
      {msg && <div className={`msg ${msg.kind}`} role="alert">{msg.text}</div>}
      <button className="btn primary" disabled={busy}>{busy ? "Changing…" : "Change password"}</button>
      <p className="hint">Rotating your password revokes every active session for this account.</p>
    </form>
  );
}
