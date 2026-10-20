/**
 * ScopeGraph X — isolated worker process (FR-OPS-01/02 core).
 *
 * Drains the durable job table and processes webhook deliveries and retention
 * sweeps on their own cadence. Runs in a separate process from the web app:
 *   npm run worker
 * The web app remains fully functional without it (inline drain on :start);
 * this process is the production-shape "isolated worker pool" (single node).
 */
import { drainQueue, recoverStaleLeases } from "../src/lib/jobs/runner";
import { processWebhookDeliveries } from "../src/lib/webhooks";
import { sweepExpiredEvidence } from "../src/lib/evidence/store";
import { db } from "../src/lib/db";

const JOB_INTERVAL_MS = Number(process.env.WORKER_JOB_INTERVAL_MS || 2000);
const MAINTENANCE_INTERVAL_MS = Number(process.env.WORKER_MAINTENANCE_INTERVAL_MS || 60_000);

let running = true;

async function processJobs() {
  while (running) {
    try {
      const { ran } = await drainQueue(20); // lease-aware claiming; multi-node safe
      if (ran === 0) break; // queue empty this cycle
    } catch (e) {
      console.error("[worker] job drain error:", e);
      break;
    }
  }
}

async function processWebhooks() {
  try {
    const results = await processWebhookDeliveries(20);
    for (const r of results) {
      if (r.status !== "DELIVERED") console.log(`[worker] webhook ${r.id}: ${r.status}`);
    }
  } catch (e) {
    console.error("[worker] webhook processing error:", e);
  }
}

async function maintenance() {
  try {
    const swept = await sweepExpiredEvidence();
    if (swept > 0) console.log(`[worker] retention sweep removed ${swept} expired evidence objects`);
  } catch (e) {
    console.error("[worker] retention sweep error:", e);
  }
}

async function main() {
  console.log(`[worker] ScopeGraph X worker ${process.env.SGX_WORKER_ID ?? "(auto-id)"} started (jobs + webhooks + retention)`);
  const stale = await recoverStaleLeases();
  if (stale > 0) console.log(`[worker] recovered ${stale} stale lease(s) from previous workers`);
  const jobTimer = setInterval(async () => {
    await processJobs();
    await processWebhooks();
  }, JOB_INTERVAL_MS);
  const maintTimer = setInterval(maintenance, MAINTENANCE_INTERVAL_MS);

  const shutdown = async () => {
    if (!running) return;
    running = false;
    clearInterval(jobTimer);
    clearInterval(maintTimer);
    console.log("[worker] shutting down…");
    await db.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // run once immediately at startup
  await processJobs();
  await processWebhooks();
  await maintenance();
}

main().catch((e) => {
  console.error("[worker] fatal:", e);
  process.exit(1);
});
