import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { newId } from "@/lib/ids";
import { importNucleiResults } from "@/lib/detection/scanner-adapter";
import { createFixtures } from "../helpers";

// End-to-end wiring test: REAL tool output formats flow through the scanner
// adapter into candidate findings (previously the real-format parsers existed
// but were never called by the import path).

const REAL_NUCLEI_JSONL = [
  JSON.stringify({
    "template-id": "tech-detect-nginx",
    info: { name: "Nginx Server Detected", severity: "info" },
    host: "shop.demo-target.test",
    "matched-at": "https://shop.demo-target.test/",
    "matcher-status": true,
  }),
  JSON.stringify({
    "template-id": "hidden-file-detected",
    info: { name: "Potential Backup File", severity: "medium" },
    host: "https://shop.demo-target.test",
    "matched-at": "https://shop.demo-target.test/backup.zip",
    "matcher-status": true,
  }),
  JSON.stringify({
    "template-id": "negative-control",
    info: { name: "Never Matches", severity: "low" },
    host: "https://shop.demo-target.test",
    "matched-at": "https://shop.demo-target.test/x",
    "matcher-status": false, // must NOT become a finding
  }),
  "{ malformed line",
].join("\n");

describe("scanner import — real-format wiring", () => {
  it("imports REAL Nuclei JSONL output into candidate findings", async () => {
    const fx = await createFixtures();
    const res = await importNucleiResults(fx.program.id, fx.org.id, REAL_NUCLEI_JSONL);
    expect(res.adapter).toBe("nuclei");
    expect(res.received).toBe(3); // malformed line dropped
    expect(res.imported).toBe(2); // matcher_status:false skipped
    const findings = await db.finding.findMany({ where: { programId: fx.program.id, id: { in: res.created } } });
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.status === "PROPOSED")).toBe(true); // candidates, never confirmed
    expect(findings.every((f) => f.assetId === fx.assetShop.id)).toBe(true);
  });

  it("imports REAL ZAP JSON reports with risk mapping", async () => {
    const fx = await createFixtures();
    const zap = {
      site: [
        {
          "@name": "https://shop.demo-target.test",
          alerts: [
            {
              name: "Missing Anti-clickjacking Header",
              riskdesc: "Low",
              instances: [{ uri: "https://shop.demo-target.test/" }],
            },
          ],
        },
      ],
    };
    const res = await importNucleiResults(fx.program.id, fx.org.id, zap);
    expect(res.adapter).toBe("zap");
    expect(res.imported).toBe(1);
    const finding = await db.finding.findUnique({ where: { id: res.created[0] } });
    expect(finding?.severity).toBe("LOW");
    expect(finding?.sourceDetector).toBe("zap");
  });

  it("still accepts the legacy internal array shape", async () => {
    const fx = await createFixtures();
    const res = await importNucleiResults(fx.program.id, fx.org.id, [
      {
        template_id: `legacy-${newId("t").slice(-6)}`,
        name: "Legacy internal shape",
        severity: "low",
        host: "shop.demo-target.test",
        matched_at: "https://shop.demo-target.test/legacy",
        matcher_status: true,
        raw_response_excerpt: "x",
      },
    ]);
    expect(res.imported).toBe(1);
  });

  it("imports nothing for unparseable input (fail closed)", async () => {
    const fx = await createFixtures();
    const res = await importNucleiResults(fx.program.id, fx.org.id, { nonsense: true });
    expect(res.received).toBe(0);
    expect(res.imported).toBe(0);
  });
});
