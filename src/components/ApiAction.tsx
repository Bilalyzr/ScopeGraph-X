"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Button that calls a /v1 API endpoint, shows RFC7807 errors, and refreshes server data. */
export function ApiAction({
  label,
  method,
  url,
  body,
  confirmText,
  className = "btn small",
  onDone,
}: {
  label: string;
  method: string;
  url: string;
  body?: unknown;
  confirmText?: string;
  className?: string;
  onDone?: (data: unknown) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(`${data.code ?? res.status}: ${data.detail ?? data.title ?? "Request failed"}`);
        return;
      }
      onDone?.(data);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button className={className} onClick={run} disabled={busy}>
        {busy ? "…" : label}
      </button>
      {error && (
        <span className="msg error" style={{ padding: "0.3rem 0.5rem", fontSize: "0.72rem" }} role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
