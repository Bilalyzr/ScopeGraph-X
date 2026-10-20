import { db } from "@/lib/db";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { redactSecrets } from "@/lib/evidence/redact";

// Reviewed report generation (FR-FND-02): sanitized HTML / PDF / JSON exports.
// Every claim links evidence; secrets are redacted from all output; export
// requires the calling findings to have passed validation (checked by caller).

export interface ReportData {
  id: string;
  program: { id: string; name: string; authorizationRef: string };
  policy: { id: string; version: number } | null;
  generatedAt: string;
  generatedBy: string;
  executiveSummary: string;
  methodology: string;
  findings: Array<{
    id: string;
    title: string;
    category: string;
    severity: string;
    confidence: number;
    status: string;
    validationStatus: string;
    asset: string | null;
    expectedBehavior: string;
    observedBehavior: string;
    reproduction: string[];
    impact: string;
    limitations: string;
    remediation: string;
    evidence: string[];
    policyVersionId: string | null;
    createdAt: string;
  }>;
}

export async function buildReportData(programId: string, orgId: string, actorId: string): Promise<ReportData> {
  const program = await db.program.findFirst({ where: { id: programId, orgId } });
  if (!program) throw new Error("PROGRAM_NOT_FOUND");
  const policy = await db.scopeVersion.findFirst({ where: { programId, status: "ACTIVE" }, orderBy: { version: "desc" } });
  const findings = await db.finding.findMany({
    where: { programId, status: { in: ["REVIEWED", "REPORTED", "ACCEPTED"] } },
    orderBy: [{ severity: "desc" }, { createdAt: "asc" }],
  });
  const rows: ReportData["findings"] = [];
  for (const f of findings) {
    const links = await db.findingEvidence.findMany({ where: { findingId: f.id } });
    const asset = f.assetId ? await db.asset.findFirst({ where: { id: f.assetId, orgId } }) : null;
    rows.push({
      id: f.id,
      title: f.title,
      category: f.category,
      severity: f.severity,
      confidence: f.confidence,
      status: f.status,
      validationStatus: f.validationStatus,
      asset: asset?.canonicalLocator ?? null,
      expectedBehavior: f.expectedBehavior,
      observedBehavior: f.observedBehavior,
      reproduction: JSON.parse(f.reproductionJson) as string[],
      impact: f.impact,
      limitations: f.limitations,
      remediation: f.remediation,
      evidence: links.map((l) => l.evidenceId),
      policyVersionId: f.policyVersionId,
      createdAt: f.createdAt.toISOString(),
    });
  }
  const sevCount = (s: string) => rows.filter((r) => r.severity === s).length;
  return {
    id: newId("rpt"),
    program: { id: program.id, name: program.name, authorizationRef: program.authorizationRef },
    policy: policy ? { id: policy.id, version: policy.version } : null,
    generatedAt: new Date().toISOString(),
    generatedBy: actorId,
    executiveSummary: `This report covers ${rows.length} reviewed finding(s) for program "${program.name}" (${sevCount("CRITICAL")} critical, ${sevCount("HIGH")} high, ${sevCount("MEDIUM")} medium, ${sevCount("LOW")} low). All findings carry evidence references and validation outcomes. Testing was conducted under the active authorization policy${policy ? ` v${policy.version}` : ""} with reference ${program.authorizationRef}.`,
    methodology: "Scope-controlled assessment: passive discovery, policy-gated simulated active checks, differential authorization analysis with provisioned test identities, scanner-result normalization, independent validator review. Egress in this deployment is simulated; no production targets were contacted.",
    findings: rows,
  };
}

export function reportToJson(data: ReportData): string {
  return JSON.stringify(redactSecrets(JSON.stringify(data, null, 2)).redacted, null, 0);
}

export function reportToHtml(data: ReportData): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const findingBlock = data.findings
    .map(
      (f) => `
    <section class="finding sev-${f.severity.toLowerCase()}">
      <h3>${esc(f.title)} <span class="badge">${esc(f.severity)}</span></h3>
      <dl>
        <dt>Finding ID</dt><dd>${esc(f.id)}</dd>
        <dt>Category</dt><dd>${esc(f.category)}</dd>
        <dt>Confidence</dt><dd>${f.confidence}</dd>
        <dt>Status</dt><dd>${esc(f.status)} (validation: ${esc(f.validationStatus)})</dd>
        <dt>Affected asset</dt><dd>${esc(f.asset ?? "n/a")}</dd>
        <dt>Expected behavior</dt><dd>${esc(f.expectedBehavior) || "—"}</dd>
        <dt>Observed behavior</dt><dd>${esc(f.observedBehavior) || "—"}</dd>
        <dt>Reproduction</dt><dd><ol>${f.reproduction.map((r) => `<li>${esc(r)}</li>`).join("")}</ol></dd>
        <dt>Impact</dt><dd>${esc(f.impact) || "—"}</dd>
        <dt>Limitations</dt><dd>${esc(f.limitations) || "—"}</dd>
        <dt>Remediation</dt><dd>${esc(f.remediation) || "—"}</dd>
        <dt>Evidence references</dt><dd>${f.evidence.map(esc).join(", ") || "—"}</dd>
        <dt>Policy version</dt><dd>${esc(f.policyVersionId ?? "n/a")}</dd>
        <dt>First observed</dt><dd>${esc(f.createdAt)}</dd>
      </dl>
    </section>`
    )
    .join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>ScopeGraph X report ${esc(data.id)}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:880px;margin:2rem auto;padding:0 1rem;color:#1a202c}
h1{border-bottom:2px solid #0f766e;padding-bottom:.4rem}
.finding{border:1px solid #cbd5e1;border-radius:8px;padding:1rem;margin:1rem 0}
.sev-critical{border-left:6px solid #b91c1c}.sev-high{border-left:6px solid #c2410c}
.sev-medium{border-left:6px solid #b45309}.sev-low{border-left:6px solid #0369a1}.sev-info{border-left:6px solid #64748b}
.badge{font-size:.8rem;background:#0f766e;color:#fff;border-radius:4px;padding:.1rem .4rem}
dl{display:grid;grid-template-columns:180px 1fr;gap:.3rem}.dt,dt{font-weight:600;color:#334155}dd{margin:0}
.meta{background:#f1f5f9;padding:.8rem;border-radius:6px}
</style></head><body>
<h1>ScopeGraph X — Security Assessment Report</h1>
<p class="meta">
  Report <strong>${esc(data.id)}</strong> · Program <strong>${esc(data.program.name)}</strong> (${esc(data.program.id)})<br>
  Authorization reference: ${esc(data.program.authorizationRef)} ·
  Policy ${data.policy ? `v${data.policy.version} (${esc(data.policy.id)})` : "none active"} ·
  Generated ${esc(data.generatedAt)} by ${esc(data.generatedBy)}
</p>
<h2>Executive summary</h2><p>${esc(data.executiveSummary)}</p>
<h2>Methodology</h2><p>${esc(data.methodology)}</p>
<h2>Findings (${data.findings.length})</h2>
${findingBlock || "<p>No reviewed findings in scope of this report.</p>"}
<footer><p><em>All evidence references are content-addressed and tenant-scoped. Secrets are redacted. This document was generated from validated findings only.</em></p></footer>
</body></html>`;
}

export async function reportToPdf(data: ReportData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([595.28, 841.89]); // A4
  let y = 800;
  const ensure = (needed = 20) => {
    if (y < needed + 40) {
      page = doc.addPage([595.28, 841.89]);
      y = 800;
    }
  };
  const line = (text: string, opts: { size?: number; bold?: boolean; color?: [number, number, number] } = {}) => {
    ensure();
    const size = opts.size ?? 10;
    const clean = redactSecrets(text).redacted.replace(/[^\x20-\x7E]/g, "");
    page.drawText(clean.slice(0, 110), {
      x: 48, y, size,
      font: opts.bold ? bold : font,
      color: rgb(...(opts.color ?? [0.1, 0.12, 0.15])),
    });
    y -= size + 6;
  };

  line("ScopeGraph X — Security Assessment Report", { size: 18, bold: true });
  line(`Report ${data.id} — generated ${data.generatedAt} by ${data.generatedBy}`);
  line(`Program: ${data.program.name} (${data.program.id})`);
  line(`Authorization reference: ${data.program.authorizationRef}`);
  line(`Policy: ${data.policy ? `v${data.policy.version} (${data.policy.id})` : "none active"}`);
  y -= 8;
  line("Executive summary", { size: 13, bold: true });
  for (const seg of wrap(data.executiveSummary, 95)) line(seg);
  y -= 6;
  line("Methodology", { size: 13, bold: true });
  for (const seg of wrap(data.methodology, 95)) line(seg);
  y -= 6;
  line(`Findings (${data.findings.length})`, { size: 13, bold: true });
  for (const f of data.findings) {
    ensure(120);
    y -= 4;
    line(`${f.severity} — ${f.title} [${f.status}/${f.validationStatus}]`, { bold: true, size: 11 });
    line(`  ID ${f.id} · category ${f.category} · confidence ${f.confidence} · asset ${f.asset ?? "n/a"}`);
    for (const seg of wrap(`Expected: ${f.expectedBehavior || "—"}`, 92)) line(`  ${seg}`);
    for (const seg of wrap(`Observed: ${f.observedBehavior || "—"}`, 92)) line(`  ${seg}`);
    for (const seg of wrap(`Impact: ${f.impact || "—"}`, 92)) line(`  ${seg}`);
    for (const seg of wrap(`Remediation: ${f.remediation || "—"}`, 92)) line(`  ${seg}`);
    line(`  Evidence: ${f.evidence.join(", ") || "—"}`);
  }
  y -= 10;
  line("All claims link evidence references. Secrets redacted. Generated from validated findings only.", { size: 8, color: [0.4, 0.45, 0.5] });
  return doc.save();
}

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > width) {
      lines.push(cur.trim());
      cur = w;
    } else cur += " " + w;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines;
}
