import { describe, expect, it } from "vitest";
import { parseNucleiJsonl, parseZapReport, toInternalResults } from "@/lib/detection/parsers";

// REAL nuclei JSONL output uses kebab-case keys with a nested info object.
const NUCLEI_JSONL = [
  JSON.stringify({
    "template-id": "cors-misconfig",
    "template-path": "http/misconfiguration/cors.yaml",
    info: { name: "CORS Misconfiguration", severity: "medium" },
    host: "https://api.demo-target.test",
    "matched-at": "https://api.demo-target.test/v1/orders",
    "matcher-status": true,
    "extracted-results": ["*"],
    timestamp: "2026-10-20T12:00:00Z",
  }),
  JSON.stringify({
    "template-id": "negative-control",
    info: { name: "No Real Match", severity: "info" },
    host: "https://shop.demo-target.test",
    "matched-at": "https://shop.demo-target.test/robots.txt",
    "matcher-status": false, // NOT matched — must be dropped by import
  }),
  "{ this line is not valid json",
  JSON.stringify({ garbage: true }), // no template-id — dropped
  "",
].join("\n");

describe("real-format scanner parsers (FR-DET-01)", () => {
  it("parses Nuclei JSONL with real kebab-case/nested-info format", () => {
    const parsed = parseNucleiJsonl(NUCLEI_JSONL);
    expect(parsed).toHaveLength(2); // garbage lines and objects dropped
    const cors = parsed[0];
    expect(cors.templateId).toBe("cors-misconfig");
    expect(cors.name).toBe("CORS Misconfiguration");
    expect(cors.severity).toBe("medium");
    expect(cors.host).toBe("https://api.demo-target.test");
    expect(cors.matcherStatus).toBe(true);
    expect(parsed[1].matcherStatus).toBe(false); // preserved for import gating
  });

  it("converts to the internal import shape (snake_case)", () => {
    const internal = toInternalResults(parseNucleiJsonl(NUCLEI_JSONL));
    expect(internal[0]).toMatchObject({
      template_id: "cors-misconfig",
      matcher_status: true,
      severity: "medium",
    });
  });

  it("parses real OWASP ZAP JSON reports with risk mapping", () => {
    const zapReport = {
      "@version": "1.0",
      generated: "Mon, 20 Oct 2026 12:00:00",
      site: [
        {
          "@name": "https://api.demo-target.test",
          alerts: [
            {
              name: "Content Security Policy (CSP) Header Not Set",
              riskdesc: "Medium",
              instances: [{ uri: "https://api.demo-target.test/v1/users", param: "", evidence: "" }],
              solution: "Ensure CSP is set.",
            },
            {
              name: "Missing Anti-clickjacking Header",
              riskdesc: "Low",
              instancescount: "2",
              instances: [{ uri: "https://shop.demo-target.test/" }],
            },
            { name: "No Instances", riskdesc: "Informational" }, // no instance/uri — dropped
          ],
        },
      ],
    };
    const parsed = parseZapReport(zapReport);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      tool: "zap",
      templateId: "zap-content-security-policy-csp-header-not-set",
      severity: "medium",
      host: "https://api.demo-target.test/v1/users",
      matcherStatus: true,
    });
    expect(parsed[1].severity).toBe("low");
  });

  it("handles empty and foreign documents without throwing", () => {
    expect(parseNucleiJsonl("")).toEqual([]);
    expect(parseZapReport({})).toEqual([]);
    expect(parseZapReport(null)).toEqual([]);
  });
});
