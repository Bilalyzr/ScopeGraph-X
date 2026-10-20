import { db } from "@/lib/db";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { authorizeEgress, revalidateConnection, acquireConcurrencySlot, releaseConcurrencySlot } from "@/lib/policy/gateway";
import { recordObservation, upsertAssetFromObservation } from "@/lib/discovery/passive";

// Durable job foundation (FR-OPS-01): SQLite-backed queue with leases, retries,
// cancellation and idempotency. Jobs are drained by an in-process worker that
// runs after mutations and via the /v1/jobs/tick maintenance endpoint.
//
// IMPORTANT: job kinds "active-probe" performs SIMULATED egress only — the
// policy gateway authorizes and the executor records the decision without any
// real network I/O (EGRESS_MODE=simulated is the only implemented mode).

export interface JobRequest {
  campaignId: string;
  kind: string;
  idempotencyKey: string;
  request: Record<string, unknown>;
}

export async function enqueueJob(jr: JobRequest) {
  const existing = await db.job.findUnique({
    where: { campaignId_idempotencyKey: { campaignId: jr.campaignId, idempotencyKey: jr.idempotencyKey } },
  });
  if (existing) return existing;
  return db.job.create({
    data: {
      id: newId("job"),
      campaignId: jr.campaignId,
      kind: jr.kind,
      idempotencyKey: jr.idempotencyKey,
      status: "QUEUED",
      requestJson: JSON.stringify(jr.request),
    },
  });
}

const ACTIVE_KINDS = new Set(["active-probe"]);

export async function runJob(jobId: string): Promise<void> {
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "QUEUED") return;
  const campaign = await db.campaign.findUnique({ where: { id: job.campaignId } });
  if (!campaign) return;
  if (campaign.state === "STOPPED" || campaign.state === "FAILED") {
    await db.job.update({ where: { id: job.id }, data: { status: "CANCELLED", finishedAt: new Date() } });
    return;
  }

  await db.job.update({ where: { id: job.id }, data: { status: "RUNNING", attempts: { increment: 1 } } });
  const request = JSON.parse(job.requestJson) as Record<string, unknown>;

  try {
    let result: Record<string, unknown>;
    if (job.kind === "passive-discovery") {
      result = await executePassiveDiscovery(campaign.programId, campaign.orgId, String(request.mode ?? "mock"));
    } else if (job.kind === "active-probe") {
      result = await executeSimulatedActiveProbe({
        orgId: campaign.orgId,
        programId: campaign.programId,
        campaignId: campaign.id,
        jobRef: job.id,
        targets: (request.targets as Array<{ host: string; path: string; method: string }>) ?? [],
      });
    } else if (job.kind === "scanner-import") {
      result = await importScannerResults(campaign.programId, campaign.orgId);
    } else if (job.kind === "ai-hypothesis") {
      result = await runAiHypothesisPass(campaign.programId, campaign.orgId, job.id);
    } else {
      throw new Error(`Unknown job kind: ${job.kind}`);
    }
    await db.job.update({
      where: { id: job.id },
      data: { status: "SUCCEEDED", resultJson: JSON.stringify(result), finishedAt: new Date() },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const job2 = await db.job.findUnique({ where: { id: job.id } });
    const failed = !job2 || job2.attempts >= job2.maxAttempts;
    await db.job.update({
      where: { id: job.id },
      data: {
        status: failed ? "FAILED" : "QUEUED", // retry with backoff semantics (re-queued)
        lastError: message,
        finishedAt: failed ? new Date() : null,
      },
    });
  }
}

export async function drainQueue(limit = 10): Promise<{ ran: number }> {
  const queued = await db.job.findMany({ where: { status: "QUEUED" }, orderBy: { createdAt: "asc" }, take: limit });
  for (const j of queued) {
    await runJob(j.id);
  }
  return { ran: queued.length };
}

// ---------------------------------------------------------------------------
// Executors (all simulated — no real network egress anywhere in this codebase)
// ---------------------------------------------------------------------------

async function executePassiveDiscovery(programId: string, orgId: string, mode: string) {
  const observations = await recordObservation(programId, mode);
  let newAssets = 0;
  for (const obs of observations) newAssets += await upsertAssetFromObservation(orgId, programId, obs);
  await audit({
    orgId,
    actorType: "SERVICE",
    actorId: "worker/passive-discovery",
    action: "campaign.passive_completed",
    resourceType: "Campaign",
    resourceId: programId,
    metadata: { observations: observations.length, newAssets },
  });
  return { observations: observations.length, newAssets, mode };
}

async function executeSimulatedActiveProbe(input: {
  orgId: string;
  programId: string;
  campaignId: string;
  jobRef: string;
  targets: Array<{ host: string; path: string; method: string }>;
}) {
  const results: Array<Record<string, unknown>> = [];
  for (const t of input.targets) {
    // Concurrency slot (single process) — the gateway also enforces budgets.
    if (!acquireConcurrencySlot(input.campaignId, 4)) {
      results.push({ ...t, decision: "DENY", reason: "Concurrency limit" });
      continue;
    }
    try {
      const authz = await authorizeEgress({
        orgId: input.orgId,
        programId: input.programId,
        campaignId: input.campaignId,
        jobRef: input.jobRef,
        host: t.host,
        path: t.path,
        method: t.method,
      });
      if (authz.decision === "ALLOW" && authz.resolvedIp) {
        // Revalidate at the (simulated) egress point — rebinding defense.
        const recheck = await revalidateConnection(t.host, authz.resolvedIp);
        results.push({ ...t, decision: recheck.decision, reason: recheck.reason, ip: authz.resolvedIp });
      } else {
        results.push({ ...t, decision: authz.decision, reason: authz.reason, code: authz.code });
      }
    } finally {
      releaseConcurrencySlot(input.campaignId);
    }
  }
  return { simulated: true, results };
}

async function importScannerResults(programId: string, orgId: string) {
  const { importMockNucleiResults } = await import("@/lib/detection/scanner-adapter");
  return importMockNucleiResults(programId, orgId);
}

async function runAiHypothesisPass(programId: string, orgId: string, jobRef: string) {
  const { generateHypothesesForProgram } = await import("@/lib/ai/provider");
  return generateHypothesesForProgram(programId, orgId, jobRef);
}

export const jobKinds = ["passive-discovery", "active-probe", "scanner-import", "ai-hypothesis"];
export function isActiveKind(kind: string): boolean {
  return ACTIVE_KINDS.has(kind);
}
