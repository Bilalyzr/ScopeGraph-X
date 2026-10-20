import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { authorizeEgress, revalidateConnection, acquireConcurrencySlot, releaseConcurrencySlot } from "@/lib/policy/gateway";
import { recordObservation, upsertAssetFromObservation } from "@/lib/discovery/passive";
import { collectLiveObservations, liveDiscoveryEnabled } from "@/lib/discovery/live";

// Durable job foundation (FR-OPS-01): SQLite-backed queue with idempotency,
// retries, cancellation, and LEASE-BASED CLAIMING so multiple worker processes
// (multi-node pools) can drain the same queue safely:
//   - claimJob() atomically flips QUEUED→RUNNING with leaseOwner/leaseUntil
//   - extendLease() heartbeats long tasks
//   - recoverStaleLeases() returns crashed-worker jobs to the queue
//   - completion is guarded by lease ownership
//
// IMPORTANT: job kind "active-probe" performs SIMULATED egress only — the
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
const LEASE_MS = 60_000;

function currentWorkerId(): string {
  return process.env.SGX_WORKER_ID || `worker-${randomBytes(4).toString("hex")}`;
}

/** Atomically claim the oldest QUEUED job for this worker (multi-node safe). */
export async function claimJob(workerId: string = currentWorkerId()): Promise<string | null> {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    UPDATE "Job"
    SET "status" = 'RUNNING',
        "leaseOwner" = ${workerId},
        "leaseUntil" = datetime('now', '+60 seconds'),
        "attempts" = "attempts" + 1,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = (
      SELECT "id" FROM "Job"
      WHERE "status" = 'QUEUED'
      ORDER BY "createdAt" ASC
      LIMIT 1
    )
    RETURNING "id"`;
  return rows[0]?.id ?? null;
}

/** Return jobs whose worker died mid-run (lease expired) to the queue. */
export async function recoverStaleLeases(): Promise<number> {
  const stale = await db.job.findMany({
    where: { status: "RUNNING", leaseUntil: { lt: new Date() }, leaseOwner: { not: null } },
    select: { id: true, attempts: true, maxAttempts: true },
  });
  for (const j of stale) {
    const failed = j.attempts >= j.maxAttempts;
    await db.job.update({
      where: { id: j.id },
      data: failed
        ? { status: "FAILED", lastError: "lease expired; attempts exhausted", finishedAt: new Date(), leaseOwner: null, leaseUntil: null }
        : { status: "QUEUED", lastError: "lease expired; requeued", leaseOwner: null, leaseUntil: null },
    });
  }
  return stale.length;
}

/** Heartbeat: extend the lease while a long task is still running. */
export async function extendLease(jobId: string, workerId: string): Promise<boolean> {
  const res = await db.job.updateMany({
    where: { id: jobId, leaseOwner: workerId },
    data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
  });
  return res.count === 1;
}

export async function runJob(jobId: string, workerId: string = currentWorkerId()): Promise<void> {
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job) return;
  // Inline path (fresh claim): only proceed if QUEUED, or already leased by us.
  if (job.status === "QUEUED") {
    await db.job.update({
      where: { id: job.id },
      data: { status: "RUNNING", leaseOwner: workerId, leaseUntil: new Date(Date.now() + LEASE_MS), attempts: { increment: 1 } },
    });
  } else if (!(job.status === "RUNNING" && job.leaseOwner === workerId)) {
    return; // claimed or completed by another worker
  }
  const campaign = await db.campaign.findUnique({ where: { id: job.campaignId } });
  if (!campaign) return;
  if (campaign.state === "STOPPED" || campaign.state === "FAILED") {
    await db.job.update({ where: { id: job.id }, data: { status: "CANCELLED", finishedAt: new Date(), leaseOwner: null, leaseUntil: null } });
    return;
  }

  const request = JSON.parse(job.requestJson) as Record<string, unknown>;

  try {
    let result: Record<string, unknown>;
    if (job.kind === "passive-discovery") {
      result = await executePassiveDiscovery(campaign.programId, campaign.orgId, String(request.mode ?? "policy-derived"));
    } else if (job.kind === "active-probe") {
      result = await executeSimulatedActiveProbe({
        orgId: campaign.orgId,
        programId: campaign.programId,
        campaignId: campaign.id,
        jobRef: job.id,
        targets: (request.targets as Array<{ host: string; path: string; method: string }>) ?? [],
      });
    } else if (job.kind === "scanner-import") {
      result = await importScannerResults(campaign.programId, campaign.orgId, (request as { results?: unknown }).results);
    } else if (job.kind === "ai-hypothesis") {
      result = await runAiHypothesisPass(campaign.programId, campaign.orgId, job.id);
    } else {
      throw new Error(`Unknown job kind: ${job.kind}`);
    }
    // Completion guarded by lease ownership (multi-node safety).
    const done = await db.job.updateMany({
      where: { id: job.id, leaseOwner: workerId, status: "RUNNING" },
      data: { status: "SUCCEEDED", resultJson: JSON.stringify(result), finishedAt: new Date(), leaseOwner: null, leaseUntil: null },
    });
    if (done.count === 0) {
      // Lease lost mid-run: never overwrite another worker's state.
      await db.job.updateMany({
        where: { id: job.id },
        data: { lastError: "lease lost during execution; result discarded", leaseOwner: null, leaseUntil: null },
      });
    }
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
        leaseOwner: null,
        leaseUntil: null,
      },
    });
  }
}

/** Lease-aware drain loop — multiple processes can call this concurrently. */
export async function drainQueue(limit = 10, workerId: string = currentWorkerId()): Promise<{ ran: number }> {
  const recovered = await recoverStaleLeases();
  if (recovered > 0) console.log(`[jobs] recovered ${recovered} stale lease(s)`);
  let ran = 0;
  while (ran < limit) {
    const jobId = await claimJob(workerId);
    if (!jobId) break;
    await runJob(jobId, workerId);
    ran += 1;
  }
  return { ran };
}

// ---------------------------------------------------------------------------
// Executors (all simulated — no real network egress anywhere in this codebase)
// ---------------------------------------------------------------------------

async function executePassiveDiscovery(programId: string, orgId: string, mode: string) {
  // LIVE mode (requires PASSIVE_DISCOVERY_MODE=live): query PUBLIC records
  // (DNS/CT/RDAP) for hosts that are already program assets — never the
  // targets themselves. Everything else stays on deterministic fixtures.
  const live = mode === "live" && liveDiscoveryEnabled();
  const observations = live ? await collectLiveObservations(orgId, programId) : await recordObservation(programId, mode);
  let newAssets = 0;
  for (const obs of observations) newAssets += await upsertAssetFromObservation(orgId, programId, obs);
  await audit({
    orgId,
    actorType: "SERVICE",
    actorId: "worker/passive-discovery",
    action: "campaign.passive_completed",
    resourceType: "Campaign",
    resourceId: programId,
    metadata: { observations: observations.length, newAssets, mode: live ? "live-public-records" : mode },
  });
  return { observations: observations.length, newAssets, mode: live ? "live-public-records" : mode };
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

async function importScannerResults(programId: string, orgId: string, results: unknown) {
  const { importNucleiResults } = await import("@/lib/detection/scanner-adapter");
  return importNucleiResults(programId, orgId, results);
}

async function runAiHypothesisPass(programId: string, orgId: string, jobRef: string) {
  const { generateHypothesesForProgram } = await import("@/lib/ai/provider");
  return generateHypothesesForProgram(programId, orgId, jobRef);
}

export const jobKinds = ["passive-discovery", "active-probe", "scanner-import", "ai-hypothesis"];
export function isActiveKind(kind: string): boolean {
  return ACTIVE_KINDS.has(kind);
}
