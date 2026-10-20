import { createHash } from "crypto";
import { db } from "@/lib/db";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";

// Change detection (FR-REC-03): snapshot an asset's normalized surface
// (endpoints + attributes), diff against the previous snapshot, and emit
// asset.changed events with before/after evidence — the researcher's
// prioritized change feed (UF-02).

export interface AssetSurface {
  endpoints: Array<{ method: string; routeTemplate: string }>;
  attributes: Record<string, unknown>; // scopeState, confidence, displayName…
}

export async function captureSurface(assetId: string): Promise<AssetSurface> {
  const asset = await db.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new Error("ASSET_NOT_FOUND");
  const endpoints = await db.endpoint.findMany({
    where: { assetId },
    select: { method: true, routeTemplate: true },
    orderBy: [{ routeTemplate: "asc" }, { method: "asc" }],
  });
  return {
    endpoints: endpoints.map((e) => ({ method: e.method, routeTemplate: e.routeTemplate })),
    attributes: { scopeState: asset.scopeState, confidence: asset.confidence, displayName: asset.displayName },
  };
}

export function surfaceFingerprint(surface: AssetSurface): string {
  return createHash("sha256").update(JSON.stringify(surface)).digest("hex");
}

export type DiffKind = "NEW_ENDPOINT" | "REMOVED_ENDPOINT" | "SCHEMA_DRIFT" | "SCOPE_STATE" | "ATTRIBUTE";

export interface SurfaceDiff {
  diffKind: DiffKind;
  before: unknown;
  after: unknown;
}

export function diffSurfaces(before: AssetSurface, after: AssetSurface): SurfaceDiff[] {
  const diffs: SurfaceDiff[] = [];
  const key = (e: { method: string; routeTemplate: string }) => `${e.method} ${e.routeTemplate}`;
  const beforeKeys = new Set(before.endpoints.map(key));
  const afterKeys = new Set(after.endpoints.map(key));
  for (const e of after.endpoints) {
    if (!beforeKeys.has(key(e))) diffs.push({ diffKind: "NEW_ENDPOINT", before: null, after: e });
  }
  for (const e of before.endpoints) {
    if (!afterKeys.has(key(e))) diffs.push({ diffKind: "REMOVED_ENDPOINT", before: e, after: null });
  }
  if (before.attributes.scopeState !== after.attributes.scopeState) {
    diffs.push({ diffKind: "SCOPE_STATE", before: before.attributes.scopeState, after: after.attributes.scopeState });
  }
  const attrKeys = new Set([...Object.keys(before.attributes), ...Object.keys(after.attributes)]);
  for (const k of attrKeys) {
    if (k === "scopeState") continue;
    if (JSON.stringify(before.attributes[k]) !== JSON.stringify(after.attributes[k])) {
      diffs.push({ diffKind: "ATTRIBUTE", before: { [k]: before.attributes[k] }, after: { [k]: after.attributes[k] } });
    }
  }
  // Same endpoint set but changed route metadata would surface as SCHEMA_DRIFT
  // when schema refs are attached (kept for adapter completeness).
  return diffs;
}

/** Snapshot + diff; records AssetChange rows (asset.changed.v1 semantics). */
export async function recordAssetChanges(assetId: string): Promise<{ changes: number; diffs: SurfaceDiff[] }> {
  const asset = await db.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new Error("ASSET_NOT_FOUND");
  const surface = await captureSurface(assetId);
  const fingerprint = surfaceFingerprint(surface);
  const lastSnapshot = await db.assetSnapshot.findFirst({
    where: { assetId },
    orderBy: { createdAt: "desc" },
  });

  await db.assetSnapshot.create({
    data: {
      id: newId("asn"),
      assetId,
      fingerprint,
      contentJson: JSON.stringify(surface),
    },
  });

  if (!lastSnapshot || lastSnapshot.fingerprint === fingerprint) {
    return { changes: 0, diffs: [] };
  }

  const before = JSON.parse(lastSnapshot.contentJson) as AssetSurface;
  const diffs = diffSurfaces(before, surface);
  for (const d of diffs) {
    await db.assetChange.create({
      data: {
        id: newId("ach"),
        orgId: asset.orgId,
        assetId,
        programId: asset.programId,
        diffKind: d.diffKind,
        beforeJson: JSON.stringify(d.before ?? null),
        afterJson: JSON.stringify(d.after ?? null),
        confidence: 0.85,
      },
    });
  }
  if (diffs.length > 0) {
    await audit({
      orgId: asset.orgId,
      actorType: "SERVICE",
      actorId: "change-detector",
      action: "asset.changed",
      resourceType: "Asset",
      resourceId: assetId,
      metadata: { diffs: diffs.length, kinds: [...new Set(diffs.map((d) => d.diffKind))] },
    });
  }
  return { changes: diffs.length, diffs };
}
