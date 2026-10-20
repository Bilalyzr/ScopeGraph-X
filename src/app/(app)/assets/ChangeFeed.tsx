import { db } from "@/lib/db";
import { ChangeList } from "@/components/ChangeList";

/** Recent change feed (FR-REC-03 / UF-02) — renders via the shared ChangeList. */
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
      <ChangeList changes={changes} locator={locator} showAssetColumn />
    </div>
  );
}
