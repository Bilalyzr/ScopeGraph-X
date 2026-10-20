import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { newId } from "@/lib/ids";
import { claimJob, recoverStaleLeases, extendLease, drainQueue } from "@/lib/jobs/runner";
import { createFixtures } from "../helpers";

describe("multi-node worker leases (FR-OPS-01/02)", () => {
  it("two workers claim disjoint jobs — no double execution", async () => {
    const fx = await createFixtures();
    const campaign = await db.campaign.create({
      data: {
        id: newId("cmp"), orgId: fx.org.id, programId: fx.program.id, policyVersionId: fx.policy.id,
        name: "lease-race", mode: "PASSIVE_ONLY",
        budgetJson: JSON.stringify({ max_requests: 100, max_rps: 10, max_concurrency: 2 }),
        state: "COMPLETED", createdBy: fx.user.id, finishedAt: new Date(),
      },
    });
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const j = await db.job.create({
        data: {
          id: newId("job"), campaignId: campaign.id, kind: "no-op-test", idempotencyKey: `k-${i}`,
          status: "QUEUED", requestJson: "{}",
        },
      });
      ids.push(j.id);
    }
    const claimedByA: string[] = [];
    const claimedByB: string[] = [];
    for (let i = 0; i < 3; i++) claimedByA.push((await claimJob("worker-a"))!);
    for (let i = 0; i < 3; i++) claimedByB.push((await claimJob("worker-b"))!);
    const all = [...claimedByA, ...claimedByB];
    expect(new Set(all).size).toBe(6); // every job claimed exactly once
    expect(await claimJob("worker-a")).toBeNull(); // queue drained
    const owners = await Promise.all(ids.map((id) => db.job.findUnique({ where: { id } })));
    expect(owners.filter((o) => o?.leaseOwner === "worker-a")).toHaveLength(3);
    expect(owners.filter((o) => o?.leaseOwner === "worker-b")).toHaveLength(3);
  });

  it("recovers stale leases: expired RUNNING jobs return to QUEUED (or FAIL at max attempts)", async () => {
    const fx = await createFixtures();
    const campaign = await db.campaign.create({
      data: {
        id: newId("cmp"), orgId: fx.org.id, programId: fx.program.id, policyVersionId: fx.policy.id,
        name: "stale", mode: "PASSIVE_ONLY", budgetJson: JSON.stringify({ max_requests: 1, max_rps: 1, max_concurrency: 1 }),
        state: "COMPLETED", createdBy: fx.user.id,
      },
    });
    const j1 = await db.job.create({
      data: {
        id: newId("job"), campaignId: campaign.id, kind: "no-op-test", idempotencyKey: "s-1",
        status: "RUNNING", attempts: 1, maxAttempts: 3, leaseOwner: "worker-dead",
        leaseUntil: new Date(Date.now() - 5_000), requestJson: "{}",
      },
    });
    const j2 = await db.job.create({
      data: {
        id: newId("job"), campaignId: campaign.id, kind: "no-op-test", idempotencyKey: "s-2",
        status: "RUNNING", attempts: 3, maxAttempts: 3, leaseOwner: "worker-dead",
        leaseUntil: new Date(Date.now() - 5_000), requestJson: "{}",
      },
    });
    const recovered = await recoverStaleLeases();
    expect(recovered).toBe(2);
    expect((await db.job.findUnique({ where: { id: j1.id } }))?.status).toBe("QUEUED"); // retried
    expect((await db.job.findUnique({ where: { id: j2.id } }))?.status).toBe("FAILED"); // attempts exhausted
  });

  it("extendLease only succeeds for the owning worker", async () => {
    const fx = await createFixtures();
    const campaign = await db.campaign.create({
      data: {
        id: newId("cmp"), orgId: fx.org.id, programId: fx.program.id, policyVersionId: fx.policy.id,
        name: "hb", mode: "PASSIVE_ONLY", budgetJson: JSON.stringify({ max_requests: 1, max_rps: 1, max_concurrency: 1 }),
        state: "COMPLETED", createdBy: fx.user.id,
      },
    });
    const j = await db.job.create({
      data: {
        id: newId("job"), campaignId: campaign.id, kind: "no-op-test", idempotencyKey: "hb-1",
        status: "RUNNING", leaseOwner: "worker-a", leaseUntil: new Date(Date.now() + 10_000), requestJson: "{}",
      },
    });
    expect(await extendLease(j.id, "worker-a")).toBe(true);
    expect(await extendLease(j.id, "worker-b")).toBe(false); // foreign worker cannot steal
  });

  it("drainQueue is lease-aware and safe to call from any process", async () => {
    const result = await drainQueue(5, "worker-test");
    expect(result).toHaveProperty("ran");
    expect(typeof result.ran).toBe("number");
  });
});
