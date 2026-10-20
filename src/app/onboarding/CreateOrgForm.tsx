"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CreateOrgForm({ hasOrgs }: { hasOrgs: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", slug: "", region: "eu-central" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding/org", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(`${data.code}: ${data.detail ?? data.title}`);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <h2 style={{ fontSize: "0.95rem", margin: "0 0 0.8rem" }}>{hasOrgs ? "Create a new organization" : "Create your organization"}</h2>
      <div className="form-row">
        <label className="field">Organization name
          <input required minLength={3} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Acme Security Labs" />
        </label>
        <label className="field">Slug
          <input required pattern="[a-z0-9][a-z0-9-]*" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="acme-security-labs" />
        </label>
      </div>
      <label className="field">Data region
        <select value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })}>
          <option value="eu-central">eu-central</option>
          <option value="us-east">us-east</option>
          <option value="ap-south">ap-south</option>
        </select>
      </label>
      {error && <div className="msg error" role="alert">{error}</div>}
      <button className="btn primary" disabled={busy}>{busy ? "Creating…" : "Create organization"}</button>
      <p className="hint">You become the TENANT_ADMIN of the new organization. Programs, policies and campaigns are isolated per organization.</p>
    </form>
  );
}
