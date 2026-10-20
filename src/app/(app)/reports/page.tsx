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
      <h1 style={{ fontSize: "1.2rem" }}>Reports & exports</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Sanitized HTML / PDF / JSON exports from validated, reviewed findings. Every claim links evidence; secrets are redacted before storage and export. Reports are never auto-submitted to third-party programs.
      </p>

      {canWrite ? (
        <GenerateReportForm programs={programs.map((p) => ({ id: p.id, name: p.name }))} />
      ) : (
        <p className="empty">Your role cannot generate reports.</p>
      )}

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="card">
          <h2>Reportable findings by program</h2>
          <table className="data">
            <thead><tr><th>Program</th><th>Review-ready</th><th>Candidates (excluded)</th></tr></thead>
            <tbody>
              {programs.map((p) => {
                const pf = findings.filter((f) => f.programId === p.id);
                return (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{pf.filter((f) => ["REVIEWED", "REPORTED", "ACCEPTED"].includes(f.status)).length}</td>
                    <td>{pf.filter((f) => f.status === "PROPOSED").length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="hint">Human-facing exports are blocked while PROPOSED findings exist for the program (409 UNREVIEWED_FINDINGS).</p>
        </div>
        <div className="card">
          <h2>Recent export records (content-addressed)</h2>
          {exports.length === 0 ? <p className="empty">No exports generated yet.</p> : (
            <table className="data">
              <thead><tr><th>Evidence</th><th>sha256</th><th>Generated</th></tr></thead>
              <tbody>
                {exports.map((e) => (
                  <tr key={e.id}>
                    <td className="mono" style={{ fontSize: "0.72rem" }}>{e.id}</td>
                    <td className="mono" style={{ fontSize: "0.72rem" }}>{e.sha256.slice(0, 20)}…</td>
                    <td className="faint" style={{ fontSize: "0.75rem" }}>{e.collectedAt.toISOString().slice(0, 16).replace("T", " ")}</td>
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
