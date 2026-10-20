import { db } from "@/lib/db";
import { newId } from "@/lib/ids";

// Passive discovery adapter (FR-REC-01). The development adapter performs no
// network lookups (EGRESS_MODE=simulated) and fabricates nothing: it observes
// only what the program itself already declares � its existing assets and the
// exact hosts named in its ACTIVE scope policy. Real DNS/CT/RDAP adapters
// implement the same interface behind configuration.

export interface PassiveObservation {
  source: "dns" | "ct" | "rdap" | "metadata" | "api-schema";
  locator: string;
  assetType: "HOST" | "DOMAIN" | "WEB_APP" | "API";
  confidence: number;
  payload: Record<string, unknown>;
  note?: string;
}

export async function recordObservation(programId: string, _mode: string): Promise<PassiveObservation[]> {
  void _mode;
  const out: PassiveObservation[] = [];
  const seen = new Set<string>();

  // 1. Re-observe assets the program already tracks (refreshes last-seen).
  const assets = await db.asset.findMany({ where: { programId }, select: { canonicalLocator: true, assetType: true, confidence: true } });
  for (const a of assets) {
    if (!["HOST", "DOMAIN", "WEB_APP", "API"].includes(a.assetType)) continue;
    seen.add(`${a.canonicalLocator}|${a.assetType}`);
    out.push({
      source: "metadata", locator: a.canonicalLocator, assetType: a.assetType as PassiveObservation["assetType"],
      confidence: a.confidence, payload: { reobserved: true }, note: "Re-observed tracked asset",
    });
  }

  // 2. Exact hosts named by the ACTIVE policy allow-list (wildcards are never expanded).
  const active = await db.scopeVersion.findFirst({ where: { programId, status: "ACTIVE" }, orderBy: { version: "desc" } });
  if (active) {
    try {
      const rules = JSON.parse(active.rulesJson) as { allow?: Array<{ host?: string }> };
      for (const r of rules.allow ?? []) {
        const host = (r.host ?? "").toLowerCase();
        if (!host || host.includes("*") || seen.has(`${host}|HOST`)) continue;
        seen.add(`${host}|HOST`);
        out.push({
          source: "metadata", locator: host, assetType: "HOST", confidence: 0.6,
          payload: { scope_version: active.version }, note: "Named in active scope policy � association only, NOT authorization",
        });
      }
    } catch {
      /* malformed rules are rejected at proposal time; ignore defensively */
    }
  }
  return out;
}
/** Upsert asset from an observation — assets start DISCOVERED (never AUTHORIZED). */
export async function upsertAssetFromObservation(
  orgId: string,
  programId: string,
  obs: PassiveObservation
): Promise<number> {
  const existing = await db.asset.findUnique({
    where: { programId_canonicalLocator_assetType: { programId, canonicalLocator: obs.locator, assetType: obs.assetType } },
  });
  if (existing) {
    await db.asset.update({ where: { id: existing.id }, data: { lastSeenAt: new Date(), confidence: obs.confidence } });
    await db.assetObservation.create({
      data: {
        id: newId("aob"),
        assetId: existing.id,
        source: obs.source,
        confidence: obs.confidence,
        payloadJson: JSON.stringify(obs.payload),
        note: obs.note ?? "",
      },
    });
    return 0;
  }
  const asset = await db.asset.create({
    data: {
      id: newId("ast"),
      orgId,
      programId,
      canonicalLocator: obs.locator,
      assetType: obs.assetType,
      displayName: obs.locator,
      scopeState: "DISCOVERED",
      confidence: obs.confidence,
    },
  });
  await db.assetObservation.create({
    data: {
      id: newId("aob"),
      assetId: asset.id,
      source: obs.source,
      confidence: obs.confidence,
      payloadJson: JSON.stringify(obs.payload),
      note: obs.note ?? "",
    },
  });
  // Graph projection: asset IN_SCOPE_OF program (association edge, not authorization).
  await db.graphEdge.upsert({
    where: {
      sourceType_sourceId_relation_targetType_targetId: {
        sourceType: "Asset", sourceId: asset.id, relation: "IN_SCOPE_OF", targetType: "Program", targetId: programId,
      },
    },
    create: {
      id: newId("ged"),
      orgId, sourceType: "Asset", sourceId: asset.id, relation: "IN_SCOPE_OF",
      targetType: "Program", targetId: programId, confidence: obs.confidence,
      policyContext: "discovered-association",
    },
    update: { confidence: obs.confidence },
  });
  return 1;
}
