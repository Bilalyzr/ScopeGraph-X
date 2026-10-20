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
      <div className="row spread" style={{ marginBottom: "0.75rem" }}>
        <div>
          <div className="mono-label" style={{ marginBottom: "0.2rem" }}>
            INSTRUMENT PANEL // REAL-TIME LEDGER
          </div>
          <h1 style={{ margin: 0 }}>
            Security operations dashboard
          </h1>
        </div>
        <div className="row">
          {stops ? (
            <span className="badge danger">⛔ EMERGENCY STOP ACTIVE</span>
          ) : (
            <span className="badge ok">
              <span className="signal-dot" style={{ width: 6, height: 6 }} /> GATEWAY ONLINE
            </span>
          )}
          <Link href="/campaigns" className="btn small primary">
            DISPATCH CAMPAIGN →
          </Link>
        </div>
      </div>

      {/* Signature Component: Section Label + Stat Rail */}
      <div className="section-label">
        <span className="section-label-num">01</span>
        <span>TELEMETRY STAT RAIL</span>
      </div>

      <div className="grid metrics" role="region" aria-label="Operational metrics stat rail">
        <div className="metric">
          <div className="label">Programs</div>
          <div className="value">{programs.length}</div>
          <div className="sub">{programs.filter((p) => p.state === "ACTIVE").length} active</div>
        </div>
        <div className="metric">
          <div className="label">Campaigns</div>
          <div className="value">{campaigns.length}</div>
          <div className="sub">{activeCampaigns} running</div>
        </div>
        <div className="metric">
          <div className="label">Assets</div>
          <div className="value">{assets.length}</div>
          <div className="sub">
            {assetsByState.AUTHORIZED ?? 0} auth · {assetsByState.DISCOVERED ?? 0} disc
          </div>
        </div>
        <div className="metric">
          <div className="label">Endpoints</div>
          <div className="value">{endpoints}</div>
          <div className="sub">normalized routes</div>
        </div>
        <div className="metric">
          <div className="label">Findings</div>
          <div className="value">{findings.length}</div>
          <div className="sub">
            {validated} validated · {findings.filter((f) => f.status === "PROPOSED").length} cand
          </div>
        </div>
        <div className="metric">
          <div className="label">Policy denials</div>
          <div className="value">{egressDenies}</div>
          <div className="sub">gateway DENY decisions</div>
        </div>
        <div className="metric">
          <div className="label">Recent changes</div>
          <div className="value">{recentChanges.length}</div>
          <div className="sub">surface diffs (7d)</div>
        </div>
      </div>

      <div className="section-label">
        <span className="section-label-num">02</span>
        <span>THREAT POSTURE &amp; AUTHORIZATION LEDGER</span>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1.08fr 0.92fr" }}>
        <div>
          <div className="card">
            <h2>
              <span>Findings by severity</span>
              <Link href="/findings" className="badge neutral">
                ALL FINDINGS →
              </Link>
            </h2>
            {findings.length === 0 ? (
              <p className="empty">No findings yet.</p>
            ) : (
              <>
                <div
                  style={{
                    display: "flex",
                    height: 8,
                    borderRadius: 999,
                    overflow: "hidden",
                    border: "1px solid var(--ink)",
                    background: "var(--surface-2)",
                    marginBottom: "0.85rem",
                  }}
                  title="Findings distribution by severity"
                >
                  {[
                    { sev: "CRITICAL", color: "var(--red)" },
                    { sev: "HIGH", color: "var(--orange)" },
                    { sev: "MEDIUM", color: "var(--amber)" },
                    { sev: "LOW", color: "var(--violet)" },
                    { sev: "INFO", color: "var(--muted)" },
                  ].map(({ sev, color }) => {
                    const count = findingsBySeverity[sev] ?? 0;
                    if (!count) return null;
                    return (
                      <span
                        key={sev}
                        style={{
                          width: `${(count / Math.max(1, findings.length)) * 100}%`,
                          background: color,
                        }}
                      />
                    );
                  })}
                </div>
                <table className="data">
                  <thead>
                    <tr>
                      <th>Severity</th>
                      <th>Count</th>
                      <th>Validated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]
                      .filter((s) => findingsBySeverity[s])
                      .map((s) => (
                        <tr key={s}>
                          <td>
                            <span className={`badge sev-${s}`}>{s}</span>
                          </td>
                          <td className="mono">{findingsBySeverity[s]}</td>
                          <td className="mono">
                            {findings.filter((f) => f.severity === s && f.validationStatus === "VALIDATED").length}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </>
            )}

            <h2 style={{ marginTop: "1.35rem" }}>Asset authorization ladder</h2>
            <p className="hint" style={{ marginTop: 0 }}>
              Discovery association ≠ ownership ≠ testing authorization. Only AUTHORIZED assets can receive active jobs.
            </p>
            <table className="data">
              <thead>
                <tr>
                  <th>Scope state</th>
                  <th>Assets</th>
                  <th style={{ width: "42%" }}>Proportion</th>
                </tr>
              </thead>
              <tbody>
                {["AUTHORIZED", "OWNERSHIP_VERIFIED", "ASSOCIATED", "DISCOVERED", "DENIED"].map((s) => {
                  const count = assetsByState[s] ?? 0;
                  const pct = Math.round((count / Math.max(1, assets.length)) * 100);
                  const barColor =
                    s === "AUTHORIZED"
                      ? "var(--green)"
                      : s === "OWNERSHIP_VERIFIED"
                        ? "var(--violet)"
                        : s === "ASSOCIATED"
                          ? "var(--amber)"
                          : s === "DENIED"
                            ? "var(--red)"
                            : "var(--muted)";
                  return (
                    <tr key={s}>
                      <td>
                        <span className={`badge scope-${s}`}>{s.replace("_", " ")}</span>
                      </td>
                      <td className="mono">{count}</td>
                      <td>
                        <div className="row" style={{ gap: "0.45rem" }}>
                          <div
                            style={{
                              flex: 1,
                              height: 7,
                              borderRadius: 999,
                              background: "var(--surface-2)",
                              border: "1px solid var(--border-ink)",
                              overflow: "hidden",
                            }}
                          >
                            <div style={{ width: `${pct}%`, height: "100%", background: barColor }} />
                          </div>
                          <span className="mono faint" style={{ fontSize: "0.68rem", width: 32, textAlign: "right" }}>
                            {pct}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2>
              <span>Recent scope &amp; surface changes</span>
              <Link href="/assets" className="badge neutral">
                INVENTORY →
              </Link>
            </h2>
            {recentChanges.length === 0 ? (
              <p className="hint">No changes detected — snapshot assets or import schemas to build the feed.</p>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Change</th>
                    <th>Before → After</th>
                  </tr>
                </thead>
                <tbody>
                  {recentChanges.map((c) => (
                    <tr key={c.id}>
                      <td className="faint" style={{ fontSize: "0.72rem", whiteSpace: "nowrap" }}>
                        {c.observedAt.toISOString().slice(0, 16).replace("T", " ")}
                      </td>
                      <td>
                        <span className="badge info">{c.diffKind.replace("_", " ")}</span>
                      </td>
                      <td className="mono" style={{ fontSize: "0.72rem" }}>
                        <code className="inline">{c.beforeJson.slice(0, 42)}</code> →{" "}
                        <code className="inline">{c.afterJson.slice(0, 42)}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div>
          <div className="card">
            <h2>
              <span>Campaign job status</span>
              <Link href="/campaigns" className="badge neutral">
                QUEUE →
              </Link>
            </h2>
            {jobs.length === 0 ? (
              <p className="empty">No jobs yet.</p>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Jobs</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(jobsByStatus).map(([s, n]) => (
                    <tr key={s}>
                      <td>
                        <span
                          className={`badge ${
                            s === "SUCCEEDED"
                              ? "ok"
                              : s === "FAILED"
                                ? "danger"
                                : s === "RUNNING" || s === "QUEUED"
                                  ? "info"
                                  : "neutral"
                          }`}
                        >
                          {s}
                        </span>
                      </td>
                      <td className="mono">{n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <h2 style={{ marginTop: "1.4rem" }}>
              <span>Recent audit activity</span>
              <Link href="/audit" className="badge neutral">
                FULL LEDGER →
              </Link>
            </h2>
            <table className="data">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Resource</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {recentAudit.map((e) => (
                  <tr key={e.id}>
                    <td className="mono">{e.action}</td>
                    <td className="mono">{e.resourceId.slice(0, 18)}</td>
                    <td>
                      <span
                        className={`badge ${
                          e.decision === "DENY" ? "danger" : e.decision === "ALLOW" ? "ok" : "neutral"
                        }`}
                      >
                        {e.decision}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Link href="/audit" className="row" style={{ marginTop: "0.75rem", fontSize: "0.85rem" }}>
              View full audit log →
            </Link>
          </div>

          {/* Signature Component: Live Terminal Panel */}
          <div className="terminal-panel">
            <div className="terminal-header">
              <span className="terminal-dots" aria-hidden="true">
                <span className="terminal-dot coral" />
                <span className="terminal-dot amber" />
                <span className="terminal-dot mint" />
              </span>
              <span className="terminal-title">policy-gateway.stream // live</span>
            </div>
            <div>
              <div>
                <span style={{ color: "var(--mint)" }}>[GATEWAY]</span> active_programs={programs.length} · authorized_assets=
                {assetsByState.AUTHORIZED ?? 0} · gateway_denials={egressDenies}
              </div>
              {recentAudit[0] && (
                <div>
                  <span style={{ color: "var(--coral)" }}>[AUDIT_HEAD]</span> {recentAudit[0].action} on{" "}
                  {recentAudit[0].resourceId.slice(0, 16)} → {recentAudit[0].decision} (sha256:{recentAudit[0].digest.slice(0, 12)}…)
                </div>
              )}
              <div style={{ color: "#9da69b" }}>
                Awaiting policy-pinned job dispatch
                <span className="terminal-cursor" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
