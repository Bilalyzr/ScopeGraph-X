// Real-format scanner output parsers (FR-DET-01). These parse output produced
// by actual tools — Nuclei JSONL (-jsonl) and OWASP ZAP JSON reports — into
// the internal common schema. Parsing is local and total: nothing is fetched
// or executed; untrusted input is coerced and malformed entries are dropped.

export interface NormalizedScannerFinding {
  tool: "nuclei" | "zap";
  templateId: string;
  name: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  host: string;
  matchedAt: string;
  matcherStatus: boolean;
  evidenceExcerpt: string;
}

const SEV = new Set(["critical", "high", "medium", "low", "info"]);
const SEV_MAP_ZAP: Record<string, NormalizedScannerFinding["severity"]> = {
  "critical": "critical", "high": "high", "medium": "medium", "moderate": "medium",
  "low": "low", "informational": "info", "info": "info",
};

/**
 * Parse real Nuclei output (JSONL, one object per line). Real keys are
 * kebab-case: {"template-id", "info":{"name","severity"}, "host",
 * "matched-at", "matcher-status", plus embedded request/response excerpts}.
 */
export function parseNucleiJsonl(input: string): NormalizedScannerFinding[] {
  const out: NormalizedScannerFinding[] = [];
  for (const line of input.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue; // malformed line dropped
    }
    const info = (raw["info"] ?? {}) as Record<string, unknown>;
    const templateId = str(raw["template-id"] ?? raw["template_id"]);
    const name = str(info["name"] ?? raw["name"]);
    const severity = str(info["severity"] ?? raw["severity"]).toLowerCase();
    const host = str(raw["host"] ?? raw["url"]);
    if (!templateId || !name || !host || !SEV.has(severity)) continue;
    out.push({
      tool: "nuclei",
      templateId,
      name,
      severity: severity as NormalizedScannerFinding["severity"],
      host,
      matchedAt: str(raw["matched-at"] ?? raw["matched_at"] ?? raw["host"]),
      // matcher-status absent => event-style output (already matched); otherwise coerce.
      matcherStatus: (raw["matcher-status"] ?? raw["matcher_status"]) === undefined
        ? true
        : Boolean(raw["matcher-status"] ?? raw["matcher_status"]),
      evidenceExcerpt: str(raw["extracted-results"] ?? raw["matched-at"] ?? templateId).slice(0, 500),
    });
  }
  return out;
}

interface ZapAlert {
  name?: unknown;
  riskdesc?: unknown;
  solution?: unknown;
  instances?: Array<{ uri?: unknown; param?: unknown; evidence?: unknown }>;
  instancescount?: unknown;
  url?: unknown;
}

/** Parse a real OWASP ZAP JSON report ({"site":[{"alerts":[…]}]}). */
export function parseZapReport(input: unknown): NormalizedScannerFinding[] {
  const out: NormalizedScannerFinding[] = [];
  const doc = input as { site?: Array<{ alerts?: ZapAlert[] }> };
  const sites = Array.isArray(doc?.site) ? doc.site : [];
  for (const site of sites) {
    for (const alert of site.alerts ?? []) {
      const name = str(alert.name);
      if (!name) continue;
      const risk = str(alert.riskdesc).split(" ")[0].toLowerCase();
      const severity = SEV_MAP_ZAP[risk];
      if (!severity) continue;
      const first = alert.instances?.[0];
      const host = str(first?.uri ?? alert.url ?? "");
      if (!host) continue;
      out.push({
        tool: "zap",
        templateId: `zap-${slug(name)}`,
        name,
        severity,
        host,
        matchedAt: str(first?.uri ?? ""),
        matcherStatus: true, // alerts present in a ZAP report are raised findings
        evidenceExcerpt: str(first?.evidence ?? alert.solution ?? "").slice(0, 500),
      });
    }
  }
  return out;
}

/** Convert normalized findings into the internal import shape. */
export function toInternalResults(findings: NormalizedScannerFinding[]) {
  return findings.map((f) => ({
    template_id: f.tool === "nuclei" ? f.templateId : f.templateId,
    name: f.name,
    severity: f.severity,
    host: f.host,
    matched_at: f.matchedAt,
    matcher_status: f.matcherStatus,
    raw_response_excerpt: f.evidenceExcerpt,
  }));
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);
}
