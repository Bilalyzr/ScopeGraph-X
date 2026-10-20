"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface OrgOption {
  id: string;
  name: string;
  role?: string;
}

/**
 * The single organization picker. Two presentations, one component:
 *  - variant="select"  → compact top-bar dropdown (switches active org)
 *  - variant="buttons" → onboarding list (large targets, redirects to dashboard)
 */
export function OrgPicker({
  orgs,
  activeOrgId,
  variant = "select",
  label = "Active organization",
}: {
  orgs: OrgOption[];
  activeOrgId: string | null;
  variant?: "select" | "buttons";
  label?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function pick(orgId: string) {
    if (orgId === activeOrgId && variant === "select") return;
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

  if (orgs.length === 0) return <span className="faint">No organization</span>;

  if (variant === "select") {
    return (
      <select
        aria-label={label}
        value={activeOrgId ?? ""}
        disabled={busy !== null}
        onChange={(e) => pick(e.target.value)}
        style={{ maxWidth: 260 }}
      >
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}{o.role ? ` — ${o.role}` : ""}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className="grid" style={{ gap: "0.5rem" }}>
      {orgs.map((o) => (
        <button
          key={o.id}
          className="btn"
          style={{ justifyContent: "space-between" }}
          onClick={() => pick(o.id)}
          disabled={busy !== null}
        >
          <span>{o.name}</span>
          <span>{busy === o.id ? "…" : "→"}</span>
        </button>
      ))}
    </div>
  );
}
