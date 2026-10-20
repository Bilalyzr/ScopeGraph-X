import { db } from "@/lib/db";
import { newId } from "@/lib/ids";
import { createFinding } from "@/lib/findings/lifecycle";
import { storeEvidence } from "@/lib/evidence/store";

// Vetted scanner adapter framework (FR-DET-01). The dev adapter ingests a
// MOCK Nuclei-style result set into the common schema — no scan is launched,
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

/** Mock scanner output for the demo targets (clearly synthetic). */
export function mockNucleiResults(): RawNucleiResult[] {
  return [
    {
      template_id: "demo-misconfig-cors",
      name: "Permissive CORS policy (DEMO fixture)",
      severity: "medium",
      host: "https://api.demo-target.test",
      matched_at: "https://api.demo-target.test/v1/orders",
      matcher_status: true,
      raw_response_excerpt: "Access-Control-Allow-Origin: *\nAuthorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dummy",
    },
    {
      template_id: "demo-info-server-header",
      name: "Server version header disclosed (DEMO fixture)",
      severity: "info",
      host: "https://shop.demo-target.test",
      matched_at: "https://shop.demo-target.test/",
      matcher_status: true,
      raw_response_excerpt: "Server: demo-server/1.2.3",
    },
    {
      template_id: "demo-negative-control",
      name: "Negative control — no real match (DEMO fixture)",
      severity: "info",
      host: "https://shop.demo-target.test",
      matched_at: "https://shop.demo-target.test/robots.txt",
      matcher_status: false, // matcher false => adapter must NOT create a finding
      raw_response_excerpt: "User-agent: *\nDisallow: /admin",
    },
  ];
}

export async function importMockNucleiResults(programId: string, orgId: string) {
  const results = mockNucleiResults();
  const created: string[] = [];
  const skipped: string[] = [];
  for (const r of results) {
    if (!r.matcher_status) {
      skipped.push(r.template_id);
      continue; // non-matching results never become findings
    }
    // Evidence stored redacted (the bearer token above must not survive).
    const { evidence } = await storeEvidence({
      orgId,
      createdBy: "scanner-adapter:nuclei-mock",
      source: "scanner:nuclei-mock",
      content: { template_id: r.template_id, matched_at: r.matched_at, raw_response_excerpt: r.raw_response_excerpt },
      sensitivity: "INTERNAL",
    });
    const asset = await db.asset.findFirst({ where: { programId, canonicalLocator: hostOf(r.host) } });
    try {
      const finding = await createFinding({
        orgId,
        programId,
        assetId: asset?.id,
        category: `scanner:${r.template_id}`,
        title: r.name,
        description: `Normalized scanner result from mock Nuclei adapter matched at ${r.matched_at}. Candidate only — requires independent validation before confirmation.`,
        severity: SEVERITY_MAP[r.severity],
        confidence: 0.4,
        observedBehavior: `Matcher matched at ${r.matched_at}`,
        expectedBehavior: "Matcher should not match on a hardened target",
        remediation: "Triage per internal scanner playbook",
        evidenceRefs: [{ evidenceId: evidence.id, role: "primary" }],
        actorId: "scanner-adapter:nuclei-mock",
        sourceDetector: "nuclei-mock",
      });
      created.push(finding.id);
    } catch (e) {
      skipped.push(`${r.template_id} (duplicate)`);
    }
  }
  return { adapter: "nuclei-mock", imported: created.length, created, skipped };
}

function hostOf(urlLike: string): string {
  try {
    return new URL(urlLike).hostname;
  } catch {
    return urlLike.replace(/^https?:\/\//, "").split("/")[0];
  }
}
