import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { currentPrincipal } from "@/lib/auth/session";
import { roleHas } from "@/lib/rbac";
import { GenerateReportForm } from "./GenerateReportForm";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const principal = await currentPrincipal();
  if (!principal?.orgId) redirect("/login");
  const programs = await db.program.findMany({ where: { orgId: principal.orgId } });
  const findings = await db.finding.findMany({ where: { orgId: principal.orgId } });
  const exports = await db.evidence.findMany({
    where: { orgId: principal.orgId, source: "report-export" },
    orderBy: { collectedAt: "desc" },
    take: 10,
  });
  const canWrite = roleHas(principal.role!, "report:write");

  return (
    <div>
      <div className="row spread" style={{ marginBottom: "0.4rem" }}>
        <div>
          <div className="mono-label">REDACTED ARTIFACTS // CONTENT-ADDRESSED EXPORTS</div>
          <h1 style={{ margin: "0.15rem 0 0" }}>Reports &amp; exports</h1>
        </div>
        <span className="badge accent">{exports.length} EXPORT BUNDLES</span>
      </div>
      <p className="muted" style={{ marginTop: "0.25rem" }}>
        Sanitized HTML / PDF / JSON exports from validated, reviewed findings. Every claim links evidence; secrets are redacted before storage and export. Reports are never auto-submitted to third-party programs.
      </p>

      <div className="section-label">
        <span className="section-label-num">01</span>
        <span>EXPORT COMPILER</span>
      </div>

      {canWrite ? (
        <GenerateReportForm programs={programs.map((p) => ({ id: p.id, name: p.name }))} />
      ) : (
        <p className="empty">Your role cannot generate reports.</p>
      )}

      <div className="section-label">
        <span className="section-label-num">02</span>
        <span>READINESS MATRIX &amp; ARCHIVAL LEDGER</span>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="card">
          <h2>Reportable findings by program</h2>
          <table className="data">
            <thead>
              <tr>
                <th>Program</th>
                <th>Review-ready</th>
                <th>Candidates (excluded)</th>
                <th>Export readiness</th>
              </tr>
            </thead>
            <tbody>
              {programs.map((p) => {
                const pf = findings.filter((f) => f.programId === p.id);
                const readyCount = pf.filter((f) => ["REVIEWED", "REPORTED", "ACCEPTED"].includes(f.status)).length;
                const candCount = pf.filter((f) => f.status === "PROPOSED").length;
                return (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.name}</strong>
                    </td>
                    <td className="mono">{readyCount}</td>
                    <td className="mono">{candCount}</td>
                    <td>
                      {candCount > 0 ? (
                        <span className="badge warn">BLOCKED ({candCount} UNREVIEWED)</span>
                      ) : readyCount > 0 ? (
                        <span className="badge ok">READY TO EXPORT</span>
                      ) : (
                        <span className="badge neutral">NO REVIEWED FINDINGS</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="hint">Human-facing exports are blocked while PROPOSED findings exist for the program (409 UNREVIEWED_FINDINGS).</p>
        </div>
        <div className="card">
          <h2>Recent export records (content-addressed)</h2>
          {exports.length === 0 ? (
            <p className="empty">No exports generated yet.</p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Evidence</th>
                  <th>sha256</th>
                  <th>Generated</th>
                </tr>
              </thead>
              <tbody>
                {exports.map((e) => (
                  <tr key={e.id}>
                    <td className="mono" style={{ fontSize: "0.72rem" }}>
                      {e.id}
                    </td>
                    <td className="mono" style={{ fontSize: "0.72rem" }}>
                      {e.sha256.slice(0, 20)}…
                    </td>
                    <td className="faint" style={{ fontSize: "0.75rem" }}>
                      {e.collectedAt.toISOString().slice(0, 16).replace("T", " ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
