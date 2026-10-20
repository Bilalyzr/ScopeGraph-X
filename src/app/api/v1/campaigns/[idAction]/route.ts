import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { enqueueJob, drainQueue } from "@/lib/jobs/runner";
import { activeScopeVersion, emergencyStopActive } from "@/lib/policy/gateway";
import { ApiError, handleApiError, requireContext, withRequestId } from "@/lib/api";

// POST /v1/campaigns/{id}:start | :stop — 202 + durable job reference on start.

async function loadCampaign(orgId: string, id: string) {
  const campaign = await db.campaign.findFirst({ where: { id, program: { orgId } } });
  if (!campaign) throw new ApiError(404, "NOT_FOUND", "Campaign not found");
  return campaign;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ idAction: string }> }) {
  let requestId = "req";
  try {
    const { idAction } = await params;
    const colon = idAction.lastIndexOf(":");
    const id = colon === -1 ? idAction : idAction.slice(0, colon);
    const action = colon === -1 ? "" : idAction.slice(colon + 1);

    if (action === "start") {
      const ctx = await requireContext(req, "campaign:execute");
      requestId = ctx.requestId;
      const campaign = await loadCampaign(ctx.orgId, id);
      if (campaign.state === "RUNNING") throw new ApiError(409, "ALREADY_RUNNING", "Campaign is already running");
      if (campaign.state !== "DRAFT") throw new ApiError(409, "INVALID_STATE", `Cannot start a campaign in state ${campaign.state}`);

      // Policy gate at scheduling time: the pinned policy must still be ACTIVE.
      const pinned = await db.scopeVersion.findUnique({ where: { id: campaign.policyVersionId } });
      if (pinned?.status === "REVOKED") throw new ApiError(409, "POLICY_REVOKED", "The policy version this campaign references was revoked");
      const active = await activeScopeVersion(campaign.programId);
      if (!active) throw new ApiError(409, "NO_ACTIVE_POLICY", "Program has no active policy; nothing may start");
      if (active.id !== campaign.policyVersionId) {
        throw new ApiError(409, "POLICY_STALE", "Campaign references an older policy version; recreate the campaign against the active version");
      }

      // Safety gate: nothing may be scheduled while a tenant- or program-wide
      // emergency stop is engaged (the gateway also re-checks at egress).
      const stopReason = await emergencyStopActive(ctx.orgId, campaign.programId);
      if (stopReason) throw new ApiError(409, "EMERGENCY_STOP_ACTIVE", stopReason);

      await db.campaign.update({ where: { id: campaign.id }, data: { state: "RUNNING", startedAt: new Date() } });

      // Enqueue passive discovery always; active probe jobs only in approved-active
      // mode AND only against AUTHORIZED assets (the gateway re-checks at egress).
      const jobs = [await enqueueJob({
        campaignId: campaign.id, kind: "passive-discovery",
        idempotencyKey: "passive-1", request: { mode: "policy-derived" },
      })];
      if (campaign.mode === "PASSIVE_THEN_APPROVED_ACTIVE") {
        const authorized = await db.asset.findMany({
          where: { programId: campaign.programId, scopeState: "AUTHORIZED" },
        });
        const targets = authorized.map((a) => ({ host: a.canonicalLocator, path: "/", method: "GET" }));
        if (targets.length > 0) {
          jobs.push(await enqueueJob({
            campaignId: campaign.id, kind: "active-probe", idempotencyKey: "active-1", request: { targets },
          }));
        }
      }
      jobs.push(await enqueueJob({
        campaignId: campaign.id, kind: "scanner-import", idempotencyKey: "scanner-1", request: {},
      }));

      await audit({
        orgId: ctx.orgId, actorId: ctx.principal.userId, action: "campaign.started",
        resourceType: "Campaign", resourceId: campaign.id, decision: "ALLOW",
        metadata: { jobs: jobs.length, mode: campaign.mode }, requestRef: ctx.requestId,
      });

      // Dev worker: drain inline (production: isolated worker pool consumes the queue).
      await drainQueue(20);

      const campaignAfter = await db.campaign.findUnique({ where: { id: campaign.id } });
      if (campaignAfter && (campaignAfter.state === "RUNNING")) {
        const remaining = await db.job.count({ where: { campaignId: campaign.id, status: "QUEUED" } });
        if (remaining === 0) {
          await db.campaign.update({ where: { id: campaign.id }, data: { state: "COMPLETED", finishedAt: new Date() } });
        }
      }
      return withRequestId({ campaign_id: campaign.id, state: "RUNNING", jobs: jobs.map((j) => j.id), request: "accepted" }, 202, ctx.requestId);
    }

    if (action === "stop") {
      const ctx = await requireContext(req, "campaign:stop");
      requestId = ctx.requestId;
      const campaign = await loadCampaign(ctx.orgId, id);
      const res = await db.job.updateMany({
        where: { campaignId: campaign.id, status: { in: ["QUEUED", "RUNNING"] } },
        data: { status: "CANCELLED", finishedAt: new Date(), lastError: "Campaign stopped" },
      });
      await db.campaign.update({ where: { id: campaign.id }, data: { state: "STOPPED", finishedAt: new Date() } });
      await audit({
        orgId: ctx.orgId, actorId: ctx.principal.userId, action: "campaign.stopped",
        resourceType: "Campaign", resourceId: campaign.id, decision: "DENY",
        reason: "Manual stop", metadata: { cancelled_jobs: res.count }, requestRef: ctx.requestId,
      });
      return withRequestId({ campaign_id: campaign.id, state: "STOPPED", jobs_cancelled: res.count }, 200, ctx.requestId);
    }

    throw new ApiError(404, "UNKNOWN_ACTION", `Unsupported action ':${action}'`);
  } catch (e) {
    return handleApiError(e, requestId);
  }
}
