/** The single severity badge — used everywhere severity is rendered. */
export function SeverityBadge({ severity }: { severity: string }) {
  return <span className={`badge sev-${severity}`}>{severity}</span>;
}

/** The single finding-status badge with lifecycle-aware coloring. */
export function FindingStatusBadge({ status }: { status: string }) {
  const cls = ["CLOSED", "ACCEPTED"].includes(status)
    ? "ok"
    : status === "REPORTED"
      ? "accent"
      : ["REJECTED", "FALSE_POSITIVE", "DUPLICATE"].includes(status)
        ? "neutral"
        : "info";
  return <span className={`badge ${cls}`}>{status.replace(/_/g, " ")}</span>;
}
