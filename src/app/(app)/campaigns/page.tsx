import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { currentPrincipal } from "@/lib/auth/session";
import { roleHas } from "@/lib/rbac";
import { ApiAction } from "@/components/ApiAction";
import { CreateCampaignForm } from "./CreateCampaignForm";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const principal = await currentPrincipal();
  if (!principal?.orgId) redirect("/login");
  const campaigns = await db.campaign.findMany({
    where: { program: { orgId: principal.orgId } },
    orderBy: { createdAt: "desc" },
  });
  const programs = await db.program.findMany({ where: { orgId: principal.orgId } });
  const policies = await db.scopeVersion.findMany({
    where: { program: { orgId: principal.orgId }, status: "ACTIVE" },
  });
  const jobs = await db.job.findMany({ where: { campaign: { program: { orgId: principal.orgId } } } });
  const canWrite = roleHas(principal.role!, "campaign:write");
  const canExecute = roleHas(principal.role!, "campaign:execute");
  const canStop = roleHas(principal.role!, "campaign:stop");

  return (
    <div>
      <h1 style={{ fontSize: "1.2rem" }}>Campaigns</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Durable, budgeted jobs. The scheduler may request a job — only the policy gateway authorizes an outbound operation. Egress in this deployment is <strong>simulated</strong>.
      </p>

      {canWrite && <CreateCampaignForm programs={programs.map((p) => ({ id: p.id, name: p.name }))} policies={policies.map((p) => ({ id: p.id, programId: p.programId, version: p.version }))} />}

      <div className="card">
        <h2>All campaigns ({campaigns.length})</h2>
        {campaigns.length === 0 ? <p className="empty">No campaigns yet.</p> : (
          <table className="data">
            <thead>
              <tr><th>Name</th><th>Mode</th><th>State</th><th>Jobs</th><th>Created by</th><th style={{ width: 220 }}>Actions</th></tr>
            </thead>
            <tbody>
              {campaigns.map((c) => {
                const cJobs = jobs.filter((j) => j.campaignId === c.id);
                const program = programs.find((p) => p.id === c.programId);
                return (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/campaigns/${c.id}`}><strong>{c.name}</strong></Link>
                      <div className="faint" style={{ fontSize: "0.72rem" }}>{program?.name}</div>
                    </td>
                    <td className="mono" style={{ fontSize: "0.72rem" }}>{c.mode}</td>
                    <td>
                      <span className={`badge ${c.state === "RUNNING" ? "info" : c.state === "COMPLETED" ? "ok" : c.state === "STOPPED" ? "warn" : "neutral"}`}>{c.state}</span>
                      {c.emergencyStoppedAt && <div className="faint" style={{ fontSize: "0.68rem" }}>e-stopped</div>}
                    </td>
                    <td>{cJobs.filter((j) => j.status === "SUCCEEDED").length}/{cJobs.length} ok</td>
                    <td className="mono" style={{ fontSize: "0.72rem" }}>{c.createdBy}</td>
                    <td>
                      <div className="row">
                        {c.state === "DRAFT" && canExecute && (
                          <ApiAction
                            label="▶ Start"
                            method="POST"
                            url={`/api/v1/campaigns/${c.id}:start`}
                            className="btn small primary"
                            confirmText="Start campaign? Jobs are enqueued; active probes are policy-gated and simulated."
                          />
                        )}
                        {(c.state === "RUNNING" || c.state === "DRAFT") && canStop && (
                          <ApiAction label="■ Stop" method="POST" url={`/api/v1/campaigns/${c.id}:stop`} className="btn small danger" confirmText="Stop campaign and cancel queued jobs?" />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
