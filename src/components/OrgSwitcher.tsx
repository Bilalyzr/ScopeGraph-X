"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function OrgSwitcher({
  orgs,
  activeOrgId,
}: {
  orgs: Array<{ id: string; name: string; role: string }>;
  activeOrgId: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function change(orgId: string) {
    setBusy(true);
    try {
      await fetch("/api/auth/orgs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org_id: orgId }),
      });
      router.push("/dashboard");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (orgs.length === 0) return <span className="faint">No organization</span>;
  return (
    <select
      aria-label="Active organization"
      value={activeOrgId ?? ""}
      disabled={busy}
      onChange={(e) => change(e.target.value)}
      style={{ maxWidth: 260 }}
    >
      {orgs.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name} — {o.role}
        </option>
      ))}
    </select>
  );
}
