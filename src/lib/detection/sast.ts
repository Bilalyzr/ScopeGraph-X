import { db } from "@/lib/db";
import { newId } from "@/lib/ids";
import { storeEvidence } from "@/lib/evidence/store";
import { audit } from "@/lib/audit";

// SAST/SCA ↔ runtime correlation (FR-DET-04): import customer-supplied static
// analysis results, store them as evidence, and LINK them to runtime findings
// when both reference the same asset — without ever auto-confirming anything.
// Correlation status stays CORRELATED_UNCONFIRMED until a human validator decides.

export interface ExternalFindingInput {
  tool: "sast" | "sca";
  rule: string;
  locator?: string;
  cwe?: string;
  severity?: string;
  description?: string;
  asset_locator?: string; // match runtime asset by canonical locator
}

export interface CorrelationResult {
  imported: number;
  correlated: number;
  externalIds: string[];
}

export async function importExternalFindings(
  programId: string,
  orgId: string,
  actorId: string,
  findings: ExternalFindingInput[]
): Promise<CorrelationResult> {
  const result: CorrelationResult = { imported: 0, correlated: 0, externalIds: [] };
  for (const f of findings.slice(0, 200)) {
    const asset = f.asset_locator
      ? await db.asset.findFirst({ where: { programId, canonicalLocator: f.asset_locator } })
      : undefined;

    const { evidence } = await storeEvidence({
      orgId,
      createdBy: actorId,
      source: `${f.tool}:import`,
      content: { tool: f.tool, rule: f.rule, locator: f.locator ?? "", cwe: f.cwe ?? "", description: f.description ?? "" },
    });

    // Link to runtime findings on the same asset + overlapping category hints.
    let correlatedFindingId: string | null = null;
    if (asset) {
      const runtime = await db.finding.findFirst({
        where: {
          programId,
          assetId: asset.id,
          // correlate on shared signal: CWE-ish suffix in category or scanner category
          OR: [{ category: { contains: f.rule } }, { category: { contains: f.cwe ?? "__none__" } }],
        },
      });
      if (runtime) correlatedFindingId = runtime.id;
    }

    const row = await db.externalFinding.create({
      data: {
        id: newId("exf"),
        orgId,
        programId,
        assetId: asset?.id,
        tool: f.tool,
        rule: f.rule,
        locator: f.locator ?? "",
        cwe: f.cwe ?? "",
        severity: f.severity ?? "MEDIUM",
        description: f.description ?? "",
        evidenceId: evidence.id,
        correlatedFindingId,
        correlationStatus: correlatedFindingId ? "CORRELATED_UNCONFIRMED" : "UNCORRELATED",
      },
    });
    result.imported += 1;
    result.externalIds.push(row.id);
    if (correlatedFindingId) result.correlated += 1;
  }

  await audit({
    orgId,
    actorId,
    action: "external_findings.imported",
    resourceType: "Program",
    resourceId: programId,
    metadata: { imported: result.imported, correlated: result.correlated },
  });
  return result;
}
