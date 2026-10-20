"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Persistent emergency-stop control shown on operational screens (PRD §9 UI). */
export function EmergencyStopButton({ active }: { active: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function trigger() {
    const reason = window.prompt("EMERGENCY STOP — enter reason (cancels queued jobs and blocks all active operations):");
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/emergency-stop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "ORG", reason }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail ?? data.title ?? "Failed");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <button
        className="btn danger"
        onClick={trigger}
        disabled={busy || active}
        title={active ? "An emergency stop is already active" : "Stop all active testing for this organization"}
      >
        ⛔ EMERGENCY STOP
      </button>
      {error && <span className="msg error" style={{ padding: "0.25rem 0.5rem", fontSize: "0.72rem" }}>{error}</span>}
    </span>
  );
}
