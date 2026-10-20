import Link from "next/link";
import { db } from "@/lib/db";

const KIND_BADGE: Record<string, string> = {
  NEW_ENDPOINT: "info", REMOVED_ENDPOINT: "warn", SCHEMA_DRIFT: "accent",
  SCOPE_STATE: "ok", ATTRIBUTE: "neutral",
};

function formatDiffJson(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const entries = Object.entries(parsed as Record<string, unknown>);
      if (entries.length === 0) return "∅";
      return entries.map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join(" · ");
    }
    return JSON.stringify(parsed);
  } catch {
    return raw;
  }
}

/** Recent change feed (FR-REC-03 / UF-02) — server-rendered from asset_changes. */
export async function ChangeFeed({ orgId, limit = 12 }: { orgId: string; limit?: number }) {
  const changes = await db.assetChange.findMany({ where: { orgId }, orderBy: { id: "desc" }, take: limit });
  const assets = await db.asset.findMany({ where: { orgId }, select: { id: true, canonicalLocator: true } });
  const locator = (assetId: string) => assets.find((a) => a.id === assetId)?.canonicalLocator ?? assetId;

  if (changes.length === 0) {
    return (
      <div className="card">
        <h2>Change feed</h2>
        <p className="empty">No changes detected yet. Snapshot an asset (asset detail → “Capture snapshot”) or import a schema to generate diffs.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Change feed (before/after)</h2>
      <table className="data">
        <thead><tr><th>When</th><th>Asset</th><th>Change</th><th>Before → After</th></tr></thead>
        <tbody>
          {changes.map((c) => (
            <tr key={c.id}>
              <td className="faint" style={{ fontSize: "0.72rem", whiteSpace: "nowrap" }}>{c.observedAt.toISOString().slice(0, 16).replace("T", " ")}</td>
              <td><Link href={`/assets/${c.assetId}`} className="mono">{locator(c.assetId)}</Link></td>
              <td><span className={`badge ${KIND_BADGE[c.diffKind] ?? "neutral"}`}>{c.diffKind.replace("_", " ")}</span></td>
              <td className="mono" style={{ fontSize: "0.72rem", maxWidth: 420 }}>
                <code className="inline" style={{ color: "var(--muted)" }}>{formatDiffJson(c.beforeJson)}</code>
                {" → "}
                <code className="inline"><strong>{formatDiffJson(c.afterJson)}</strong></code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
