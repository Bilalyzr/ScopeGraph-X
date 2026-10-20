import { db } from "@/lib/db";
import { createFinding } from "@/lib/findings/lifecycle";
import { storeEvidence } from "@/lib/evidence/store";
import { parseNucleiJsonl, parseZapReport, toInternalResults } from "./parsers";

// Vetted scanner adapter framework (FR-DET-01). Ingests REAL scanner output —
// Nuclei JSONL (string), OWASP ZAP JSON reports (object with `site`), or the
// internal array shape — normalizes it into the common schema, and creates
// CANDIDATE findings. No scan is launched; hosts must already be program
// assets; results stay candidates until independently validated.

interface RawNucleiResult {
  template_id: string;
  name: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  host: string;
  matched_at: string;
  matcher_status: boolean;
  raw_response_excerpt: string;
}

const SEVERITY_MAP = { critical: "CRITICAL", high: "HIGH", medium: "MEDIUM", low: "LOW", info: "INFO" } as const;

/**
 * Accepts every supported input shape and yields internal-format results:
 *  - string            → real Nuclei JSONL (kebab-case keys, nested info)
 *  - {site:[…]} object → real OWASP ZAP JSON report
 *  - array             → internal shape (snake_case) — legacy jobs / tests
 */
export function normalizeScannerInput(raw: unknown): { tool: "nuclei" | "zap"; results: RawNucleiResult[] } {
  if (typeof raw === "string" && raw.trim()) {
    return { tool: "nuclei", results: toInternalResults(parseNucleiJsonl(raw)) };
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw) && Array.isArray((raw as { site?: unknown }).site)) {
    return { tool: "zap", results: toInternalResults(parseZapReport(raw)) };
  }
  if (Array.isArray(raw)) {
    return { tool: "nuclei", results: raw.filter((r): r is RawNucleiResult => isValidInternal(r)) };
  }
  return { tool: "nuclei", results: [] };
}

function isValidInternal(r: unknown): r is RawNucleiResult {
  return (
    !!r && typeof r === "object" &&
    typeof (r as RawNucleiResult).template_id === "string" &&
    typeof (r as RawNucleiResult).name === "string" &&
    typeof (r as RawNucleiResult).host === "string" &&
    typeof (r as RawNucleiResult).matched_at === "string" &&
    (r as RawNucleiResult).severity in SEVERITY_MAP
  );
}

/**
 * Import scanner output supplied with the job. No results are fabricated: an
 * empty/missing/unparseable set imports nothing. Results are only accepted
 * for hosts that are already assets of the program, so a scanner can never
 * attach findings to targets outside the program.
 */
export async function importNucleiResults(programId: string, orgId: string, rawResults: unknown) {
  const { tool, results } = normalizeScannerInput(rawResults);
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
      createdBy: `scanner-adapter:${tool}`,
      source: `scanner:${tool}`,
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
        description: `Normalized ${tool} result matched at ${r.matched_at}. Candidate only — requires independent validation before confirmation.`,
        severity: SEVERITY_MAP[r.severity],
        confidence: 0.4,
        observedBehavior: `Matcher matched at ${r.matched_at}`,
        expectedBehavior: "Matcher should not match on a hardened target",
        remediation: "Triage per internal scanner playbook",
        evidenceRefs: [{ evidenceId: evidence.id, role: "primary" }],
        actorId: `scanner-adapter:${tool}`,
        sourceDetector: tool,
      });
      created.push(finding.id);
    } catch {
      skipped.push(`${r.template_id} (duplicate)`);
    }
  }
  return { adapter: tool, received: results.length, imported: created.length, created, skipped };
}

function hostOf(urlLike: string): string {
  try {
    return new URL(urlLike).hostname;
  } catch {
    return urlLike.replace(/^https?:\/\//, "").split("/")[0];
  }
}
