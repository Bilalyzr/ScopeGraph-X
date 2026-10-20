"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PickOrgForm({ orgs }: { orgs: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function pick(orgId: string) {
    setBusy(orgId);
    try {
      await fetch("/api/auth/orgs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org_id: orgId }),
      });
      router.push("/dashboard");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <h2 style={{ fontSize: "0.95rem", margin: "0 0 0.6rem" }}>Your organizations</h2>
      <div className="grid" style={{ gap: "0.5rem" }}>
        {orgs.map((o) => (
          <button key={o.id} className="btn" style={{ justifyContent: "space-between" }} onClick={() => pick(o.id)} disabled={busy !== null}>
            <span>{o.name}</span>
            <span>{busy === o.id ? "…" : "→"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
