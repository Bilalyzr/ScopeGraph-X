import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { currentPrincipal } from "@/lib/auth/session";
import { ApiAction } from "@/components/ApiAction";
import { BackLink } from "@/components/BackLink";

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await currentPrincipal();
  if (!principal?.orgId) redirect("/login");
  const { id } = await params;
  const campaign = await db.campaign.findFirst({ where: { id, program: { orgId: principal.orgId } } });
  if (!campaign) notFound();

  const jobs = await db.job.findMany({ where: { campaignId: campaign.id }, orderBy: { createdAt: "asc" } });
  const egress = await db.egressCheck.findMany({ where: { campaignId: campaign.id }, orderBy: { timestamp: "desc" }, take: 30 });
  const policy = await db.scopeVersion.findUnique({ where: { id: campaign.policyVersionId } });
  const budget = JSON.parse(campaign.budgetJson);

  return (
    <div>
      <BackLink href="/campaigns" label="All campaigns" />
      <div className="row spread">
        <div>
          <div className="mono-label">CAMPAIGN TELEMETRY // EGRESS TRACE</div>
          <h1 style={{ margin: "0.15rem 0 0" }}>{campaign.name}</h1>
          <p className="muted mono" style={{ margin: "0.3rem 0 0", fontSize: "0.8rem" }}>
            {campaign.id} · mode {campaign.mode} · policy {policy ? `v${policy.version} (${policy.status})` : "—"}
          </p>
        </div>
        <div className="row">
          <span className={`badge ${campaign.state === "RUNNING" ? "info" : campaign.state === "COMPLETED" ? "ok" : "neutral"}`}>
            {campaign.state}
          </span>
          {campaign.state === "DRAFT" && (
            <ApiAction label="▶ Start" method="POST" url={`/api/v1/campaigns/${campaign.id}:start`} className="btn primary" confirmText="Start campaign?" />
          )}
          {(campaign.state === "RUNNING" || campaign.state === "DRAFT") && (
            <ApiAction label="■ Stop" method="POST" url={`/api/v1/campaigns/${campaign.id}:stop`} className="btn danger" confirmText="Stop and cancel queued jobs?" />
          )}
        </div>
      </div>

      <div className="section-label">
        <span className="section-label-num">01</span>
        <span>BUDGET &amp; GATEWAY STAT RAIL</span>
      </div>

      <div className="grid metrics">
        <div className="metric">
          <div className="label">Budget</div>
          <div className="value" style={{ fontSize: "1.45rem" }}>
            {budget.max_requests} req · {budget.max_rps} rps
          </div>
          <div className="sub">concurrency {budget.max_concurrency}</div>
        </div>
        <div className="metric">
          <div className="label">Jobs</div>
          <div className="value">{jobs.length}</div>
          <div className="sub">
            {jobs.filter((j) => j.status === "SUCCEEDED").length} succeeded · {jobs.filter((j) => j.status === "CANCELLED").length} cancelled
          </div>
        </div>
        <div className="metric">
          <div className="label">Gateway decisions</div>
          <div className="value">
            {egress.filter((e) => e.decision === "ALLOW").length}
            <span className="faint" style={{ fontSize: "1rem" }}>
              {" "}
              / {egress.filter((e) => e.decision === "DENY").length}
            </span>
          </div>
          <div className="sub">allow / deny (simulated)</div>
        </div>
        <div className="metric">
          <div className="label">Budget utilization</div>
          <div className="value" style={{ fontSize: "1.45rem" }}>
            {Math.min(100, Math.round((egress.filter((e) => e.decision === "ALLOW").length / Math.max(1, budget.max_requests)) * 100))}%
          </div>
          <div className="sub">
            {egress.filter((e) => e.decision === "ALLOW").length} of {budget.max_requests} req used
          </div>
        </div>
      </div>

      <div className="section-label">
        <span className="section-label-num">02</span>
        <span>JOB QUEUE &amp; POLICY GATEWAY DECISIONS</span>
      </div>

      <div className="card">
        <h2>Jobs</h2>
        {jobs.length === 0 ? (
          <p className="empty">No jobs enqueued.</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Kind</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Idempotency key</th>
                <th>Result / error</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td className="mono">{j.kind}</td>
                  <td>
                    <span
                      className={`badge ${
                        j.status === "SUCCEEDED"
                          ? "ok"
                          : j.status === "FAILED"
                            ? "danger"
                            : j.status === "CANCELLED"
                              ? "warn"
                              : "info"
                      }`}
                    >
                      {j.status}
                    </span>
                  </td>
                  <td className="mono">
                    {j.attempts}/{j.maxAttempts}
                  </td>
                  <td className="mono" style={{ fontSize: "0.72rem" }}>
                    {j.idempotencyKey}
                  </td>
                  <td className="mono" style={{ fontSize: "0.72rem", maxWidth: 420 }}>
                    {j.lastError ? (
                      <span style={{ color: "var(--danger)" }}>{j.lastError}</span>
                    ) : j.resultJson ? (
                      JSON.stringify(JSON.parse(j.resultJson)).slice(0, 160)
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Policy gateway egress checks (simulated)</h2>
        {egress.length === 0 ? (
          <p className="empty">No outbound operations were requested in this campaign.</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Destination</th>
                <th>Decision</th>
                <th>Reason</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {egress.map((e) => (
                <tr key={e.id}>
                  <td className="mono">{e.destination}</td>
                  <td>
                    <span className={`badge ${e.decision === "ALLOW" ? "ok" : "danger"}`}>{e.decision}</span>
                  </td>
                  <td style={{ fontSize: "0.82rem" }}>{e.reason}</td>
                  <td className="faint" style={{ fontSize: "0.72rem" }}>
                    {e.timestamp.toISOString().slice(11, 19)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
