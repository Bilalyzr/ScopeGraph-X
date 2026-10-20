import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { currentPrincipal } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const principal = await currentPrincipal();
  if (!principal?.orgId) redirect("/login");
  const orgId = principal.orgId;

  // Every metric below is derived from stored application data (PRD §B).
  const [programs, campaigns, assets, findings, jobs, egressDenies, recentAudit, stops, recentChanges] = await Promise.all([
    db.program.findMany({ where: { orgId } }),
    db.campaign.findMany({ where: { orgId } }),
    db.asset.findMany({ where: { orgId } }),
    db.finding.findMany({ where: { orgId } }),
    db.job.findMany({ where: { campaign: { orgId } } }),
    db.egressCheck.count({ where: { orgId, decision: "DENY" } }),
    db.auditEvent.findMany({ where: { orgId }, orderBy: { timestamp: "desc" }, take: 8 }),
    db.emergencyStop.findFirst({ where: { active: true, OR: [{ scope: "GLOBAL" }, { orgId }] } }),
    db.assetChange.findMany({ where: { orgId }, orderBy: { id: "desc" }, take: 5 }),
  ]);

  const activeCampaigns = campaigns.filter((c) => c.state === "RUNNING").length;
  const assetsByState = assets.reduce<Record<string, number>>((acc, a) => ({ ...acc, [a.scopeState]: (acc[a.scopeState] ?? 0) + 1 }), {});
  const findingsBySeverity = findings.reduce<Record<string, number>>((acc, f) => ({ ...acc, [f.severity]: (acc[f.severity] ?? 0) + 1 }), {});
  const validated = findings.filter((f) => f.validationStatus === "VALIDATED").length;
  const jobsByStatus = jobs.reduce<Record<string, number>>((acc, j) => ({ ...acc, [j.status]: (acc[j.status] ?? 0) + 1 }), {});
  const endpoints = await db.endpoint.count({ where: { asset: { orgId } } });

  return (
    <div>
      <div className="row spread" style={{ marginBottom: "1rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.3rem" }}>Security operations dashboard<span className="demo-tag">demo data</span></h1>
        {stops && <span className="badge danger">EMERGENCY STOP ACTIVE</span>}
      </div>

      <div className="grid metrics">
        <div className="metric"><div className="label">Programs</div><div className="value">{programs.length}</div><div className="sub">{programs.filter((p) => p.state === "ACTIVE").length} active</div></div>
        <div className="metric"><div className="label">Campaigns</div><div className="value">{campaigns.length}</div><div className="sub">{activeCampaigns} running</div></div>
        <div className="metric"><div className="label">Assets</div><div className="value">{assets.length}</div><div className="sub">{assetsByState.AUTHORIZED ?? 0} authorized · {assetsByState.DISCOVERED ?? 0} discovered</div></div>
        <div className="metric"><div className="label">Endpoints</div><div className="value">{endpoints}</div><div className="sub">normalized routes</div></div>
        <div className="metric"><div className="label">Findings</div><div className="value">{findings.length}</div><div className="sub">{validated} validated · {findings.filter((f) => f.status === "PROPOSED").length} candidates</div></div>
        <div className="metric"><div className="label">Policy denials</div><div className="value">{egressDenies}</div><div className="sub">gateway DENY decisions</div></div>
        <div className="metric"><div className="label">Recent changes</div><div className="value">{recentChanges.length}</div><div className="sub">asset surface diffs (7d window shown)</div></div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", marginTop: "1rem" }}>
        <div className="card">
          <h2>Findings by severity</h2>
          {findings.length === 0 ? (
            <p className="empty">No findings yet.</p>
          ) : (
            <table className="data">
              <thead><tr><th>Severity</th><th>Count</th><th>Validated</th></tr></thead>
              <tbody>
                {["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"].filter((s) => findingsBySeverity[s]).map((s) => (
                  <tr key={s}>
                    <td><span className={`badge sev-${s}`}>{s}</span></td>
                    <td>{findingsBySeverity[s]}</td>
                    <td>{findings.filter((f) => f.severity === s && f.validationStatus === "VALIDATED").length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h2 style={{ marginTop: "1.2rem" }}>Recent scope & surface changes</h2>
          {recentChanges.length === 0 ? (
            <p className="hint">No changes detected — snapshot assets or import schemas to build the feed.</p>
          ) : (
            <table className="data">
              <thead><tr><th>When</th><th>Change</th><th>Before → After</th></tr></thead>
              <tbody>
                {recentChanges.map((c) => (
                  <tr key={c.id}>
                    <td className="faint" style={{ fontSize: "0.72rem" }}>{c.observedAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                    <td><span className="badge info">{c.diffKind.replace("_", " ")}</span></td>
                    <td className="mono" style={{ fontSize: "0.72rem" }}><span className="faint">{c.beforeJson}</span> → <strong>{c.afterJson}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h2 style={{ marginTop: "1.2rem" }}>Asset authorization ladder</h2>
          <p className="hint" style={{ marginTop: 0 }}>
            Discovery association ≠ ownership ≠ testing authorization. Only AUTHORIZED assets can receive active jobs.
          </p>
          <table className="data">
            <thead><tr><th>Scope state</th><th>Assets</th></tr></thead>
            <tbody>
              {["AUTHORIZED", "OWNERSHIP_VERIFIED", "ASSOCIATED", "DISCOVERED", "DENIED"].map((s) => (
                <tr key={s}><td><span className={`badge scope-${s}`}>{s.replace("_", " ")}</span></td><td>{assetsByState[s] ?? 0}</td></tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>Campaign job status</h2>
          {jobs.length === 0 ? (
            <p className="empty">No jobs yet.</p>
          ) : (
            <table className="data">
              <thead><tr><th>Status</th><th>Jobs</th></tr></thead>
              <tbody>
                {Object.entries(jobsByStatus).map(([s, n]) => (
                  <tr key={s}><td><span className={`badge ${s === "SUCCEEDED" ? "ok" : s === "FAILED" ? "danger" : s === "RUNNING" || s === "QUEUED" ? "info" : "neutral"}`}>{s}</span></td><td>{n}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          <h2 style={{ marginTop: "1.2rem" }}>Recent audit activity</h2>
          <table className="data">
            <thead><tr><th>Action</th><th>Resource</th><th>Decision</th></tr></thead>
            <tbody>
              {recentAudit.map((e) => (
                <tr key={e.id}>
                  <td className="mono">{e.action}</td>
                  <td className="mono">{e.resourceId.slice(0, 18)}</td>
                  <td><span className={`badge ${e.decision === "DENY" ? "danger" : e.decision === "ALLOW" ? "ok" : "neutral"}`}>{e.decision}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Link href="/audit" className="row" style={{ marginTop: "0.6rem", fontSize: "0.85rem" }}>View full audit log →</Link>
        </div>
      </div>
    </div>
  );
}
