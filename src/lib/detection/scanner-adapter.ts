import { db } from "@/lib/db";
import { createFinding } from "@/lib/findings/lifecycle";
import { storeEvidence } from "@/lib/evidence/store";

// Vetted scanner adapter framework (FR-DET-01). Ingests scanner output that is
// supplied with the job (Nuclei-style) into the common schema — no scan is launched,
// and results remain CANDIDATE findings until independently validated.

interface RawNucleiResult {
  template_id: string;
  name: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  host: string;
  matched_at: string;
  matcher_status: boolean;
  extracted_results?: string[];
  raw_response_excerpt: string;
}

const SEVERITY_MAP = { critical: "CRITICAL", high: "HIGH", medium: "MEDIUM", low: "LOW", info: "INFO" } as const;

/** Coerce untrusted job input into well-formed Nuclei-style results (drops anything malformed). */
function parseResults(input: unknown): RawNucleiResult[] {
  if (!Array.isArray(input)) return [];
  return input.filter((r): r is RawNucleiResult =>
    !!r && typeof r === "object" &&
    typeof (r as RawNucleiResult).template_id === "string" &&
    typeof (r as RawNucleiResult).name === "string" &&
    typeof (r as RawNucleiResult).host === "string" &&
    typeof (r as RawNucleiResult).matched_at === "string" &&
    (r as RawNucleiResult).severity in SEVERITY_MAP
  );
}

/**
 * Import scanner output that was actually supplied with the job request.
 * No results are fabricated: an empty / missing result set imports nothing.
 * Results are only accepted for hosts that are already assets of the program,
 * so a scanner can never attach findings to targets outside the program.
 */
export async function importNucleiResults(programId: string, orgId: string, rawResults: unknown) {
  const results = parseResults(rawResults);
  const created: string[] = [];
  const skipped: string[] = [];
  for (const r of results) {
    if (!r.matcher_status) {
      skipped.push(r.template_id);
      continue; // non-matching results never become findings
    }
    const asset = await db.asset.findFirst({ where: { programId, orgId, canonicalLocator: hostOf(r.host) } });
    if (!asset) {
      skipped.push(`${r.template_id} (host not in program)`);
      continue;
    }
    const { evidence } = await storeEvidence({
      orgId,
      createdBy: "scanner-adapter:nuclei",
      source: "scanner:nuclei",
      content: { template_id: r.template_id, matched_at: r.matched_at, raw_response_excerpt: r.raw_response_excerpt ?? "" },
      sensitivity: "INTERNAL",
    });
    try {
      const finding = await createFinding({
        orgId,
        programId,
        assetId: asset.id,
        category: `scanner:${r.template_id}`,
        title: r.name,
        description: `Normalized scanner result matched at ${r.matched_at}. Candidate only � requires independent validation before confirmation.`,
        severity: SEVERITY_MAP[r.severity],
        confidence: 0.4,
        observedBehavior: `Matcher matched at ${r.matched_at}`,
        expectedBehavior: "Matcher should not match on a hardened target",
        remediation: "Triage per internal scanner playbook",
        evidenceRefs: [{ evidenceId: evidence.id, role: "primary" }],
        actorId: "scanner-adapter:nuclei",
        sourceDetector: "nuclei",
      });
      created.push(finding.id);
    } catch {
      skipped.push(`${r.template_id} (duplicate)`);
    }
  }
  return { adapter: "nuclei", received: results.length, imported: created.length, created, skipped };
}
function hostOf(urlLike: string): string {
  try {
    return new URL(urlLike).hostname;
  } catch {
    return urlLike.replace(/^https?:\/\//, "").split("/")[0];
  }
}
