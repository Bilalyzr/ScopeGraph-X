import { db } from "@/lib/db";
import { newId } from "@/lib/ids";

// Passive discovery adapter (FR-REC-01). The dev adapter deterministically
// generates mock observations from a fixture set — clearly labeled DEMO data.
// Real DNS/CT/RDAP adapters implement the same interface behind configuration.

export interface PassiveObservation {
  source: "dns" | "ct" | "rdap" | "metadata" | "api-schema";
  locator: string;
  assetType: "HOST" | "DOMAIN" | "WEB_APP" | "API";
  confidence: number;
  payload: Record<string, unknown>;
  note?: string;
}

/** Fixture corpus for the demo program targets (*.demo-target.test). */
const FIXTURES: PassiveObservation[] = [
  { source: "dns", locator: "shop.demo-target.test", assetType: "HOST", confidence: 0.95, payload: { record: "A", value: "203.0.113.10" } },
  { source: "dns", locator: "api.demo-target.test", assetType: "HOST", confidence: 0.95, payload: { record: "A", value: "203.0.113.11" } },
  { source: "dns", locator: "admin.demo-target.test", assetType: "HOST", confidence: 0.9, payload: { record: "A", value: "203.0.113.12" } },
  { source: "ct", locator: "staging.demo-target.test", assetType: "HOST", confidence: 0.7, payload: { cert_issuer: "mock-ca", san: ["staging.demo-target.test"] }, note: "Certificate transparency hit — association only, NOT authorization" },
  { source: "rdap", locator: "demo-target.test", assetType: "DOMAIN", confidence: 0.85, payload: { registrar: "mock-registrar", created: "2024-01-01" } },
  { source: "api-schema", locator: "api.demo-target.test", assetType: "API", confidence: 0.9, payload: { openapi: "3.1", paths: ["/v1/orders", "/v1/users/{id}", "/v1/admin/export"] } },
];

export async function recordObservation(programId: string, mode: string): Promise<PassiveObservation[]> {
  // Deterministic pseudo-variation so repeated runs can show change detection.
  const run = await db.assetObservation.count({ where: { asset: { programId } } });
  const selected = FIXTURES.filter((_, i) => (i + run) % 3 !== 2 || run === 0);
  return selected;
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
