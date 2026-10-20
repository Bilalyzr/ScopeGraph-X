import { db } from "@/lib/db";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { dispatchWebhookEvent } from "@/lib/webhooks";

// Emergency stop + policy revocation with propagation (PRD §6 revocation steps,
// UF-06). Both cancel queued work, mark campaigns stopped, and audit the event.

export async function triggerEmergencyStop(input: {
  scope: "GLOBAL" | "ORG" | "PROGRAM";
  orgId?: string;
  programId?: string;
  reason: string;
  createdBy: string;
}) {
  if (input.scope === "PROGRAM" && input.programId && input.orgId) {
    const prog = await db.program.findFirst({ where: { id: input.programId, orgId: input.orgId } });
    if (!prog) throw new Error("PROGRAM_NOT_FOUND_IN_ORG");
  }

  const stop = await db.emergencyStop.create({
    data: {
      id: newId("ems"),
      scope: input.scope,
      orgId: input.orgId,
      programId: input.programId,
      reason: input.reason,
      createdBy: input.createdBy,
      active: true,
    },
  });

  const affectedCampaigns = await db.campaign.findMany({
    where: {
      state: "RUNNING",
      ...(input.scope === "PROGRAM"
        ? { programId: input.programId!, ...(input.orgId ? { orgId: input.orgId } : {}) }
        : {}),
      ...(input.scope === "ORG" ? { program: { orgId: input.orgId! } } : {}),
    },
  });

  let cancelledJobs = 0;
  for (const c of affectedCampaigns) {
    const res = await db.job.updateMany({
      where: { campaignId: c.id, status: { in: ["QUEUED", "RUNNING"] } },
      data: { status: "CANCELLED", finishedAt: new Date(), lastError: "Emergency stop" },
    });
    cancelledJobs += res.count;
    await db.campaign.update({
      where: { id: c.id },
      data: { state: "STOPPED", emergencyStoppedAt: new Date(), finishedAt: new Date() },
    });
  }

  await audit({
    orgId: input.orgId ?? "system",
    actorId: input.createdBy,
    action: "safety.emergency_stop",
    resourceType: "EmergencyStop",
    resourceId: stop.id,
    decision: "DENY",
    reason: input.reason,
    metadata: { scope: input.scope, campaigns: affectedCampaigns.length, cancelledJobs },
  });
  if (input.orgId) {
    await dispatchWebhookEvent(input.orgId, "safety.emergency_stop", {
      stop_id: stop.id,
      scope: input.scope,
      reason: input.reason,
      campaigns_stopped: affectedCampaigns.length,
      jobs_cancelled: cancelledJobs,
    });
  }

  return { stop, campaigns: affectedCampaigns.length, cancelledJobs };
}

export async function liftEmergencyStop(stopId: string, actorId: string) {
  const stop = await db.emergencyStop.update({
    where: { id: stopId },
    data: { active: false, liftedAt: new Date() },
  });
  await audit({
    orgId: stop.orgId ?? "system",
    actorId,
    action: "safety.emergency_stop_lifted",
    resourceType: "EmergencyStop",
    resourceId: stopId,
    decision: "ALLOW",
  });
  return stop;
}

/** Revoke a scope version and propagate: no new operations, cancel queued work. */
export async function revokeScopeVersion(scopeVersionId: string, actorId: string, reason: string) {
  const policy = await db.scopeVersion.findUnique({ where: { id: scopeVersionId } });
  if (!policy) throw new Error("NOT_FOUND");

  await db.scopeVersion.update({
    where: { id: scopeVersionId },
    data: { status: "REVOKED", revokedAt: new Date(), revokedReason: reason },
  });

  const affectedCampaigns = await db.campaign.findMany({
    where: { policyVersionId: policy.id, state: { in: ["RUNNING", "DRAFT"] } },
  });
  let cancelledJobs = 0;
  for (const c of affectedCampaigns) {
    const res = await db.job.updateMany({
      where: { campaignId: c.id, status: { in: ["QUEUED", "RUNNING"] } },
      data: { status: "CANCELLED", finishedAt: new Date(), lastError: "Policy revoked" },
    });
    cancelledJobs += res.count;
    await db.campaign.update({
      where: { id: c.id },
      data: { state: "STOPPED", finishedAt: new Date() },
    });
  }

  const program = await db.program.findUnique({ where: { id: policy.programId } });
  const orgId = program!.orgId;

  await audit({
    orgId,
    actorId,
    action: "policy.revoked",
    resourceType: "ScopeVersion",
    resourceId: scopeVersionId,
    decision: "DENY",
    reason,
    metadata: { version: policy.version, campaigns: affectedCampaigns.length, cancelledJobs },
  });
  await dispatchWebhookEvent(orgId, "policy.revoked", {
    scope_id: scopeVersionId,
    version: policy.version,
    reason,
    campaigns_stopped: affectedCampaigns.length,
    jobs_cancelled: cancelledJobs,
  });

  return { policy, campaigns: affectedCampaigns.length, cancelledJobs };
}
