import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { newId } from "@/lib/ids";
import { authorizeEgress, revalidateConnection, resetRuntimeBudgets } from "@/lib/policy/gateway";
import { registerDnsFixture } from "@/lib/policy/ipguard";
import { triggerEmergencyStop } from "@/lib/safety";
import { createFixtures } from "../helpers";
import type { Asset, Campaign, Organization, Program, ScopeVersion, User } from "@prisma/client";

// ADVERSARIAL POLICY SUITE (PRD §12 "Policy adversarial" — launch gate:
// zero unauthorized egress). All egress is simulated; the assertions check the
// gateway's decisions and the recorded EgressCheck rows.

let fx: {
  org: Organization; user: User; program: Program; policy: ScopeVersion; rules: unknown;
  assetShop: Asset; assetAdmin: Asset; assetStaging: Asset; addAsset: (l: string, s: string) => Promise<Asset>;
};
let campaign: Campaign;

async function makeCampaign(policyId = fx.policy.id) {
  return db.campaign.create({
    data: {
      id: newId("cmp"), orgId: fx.org.id, programId: fx.program.id, policyVersionId: policyId,
      name: "test campaign", mode: "PASSIVE_THEN_APPROVED_ACTIVE",
      budgetJson: JSON.stringify({ max_requests: 3, max_rps: 10, max_concurrency: 2 }),
      state: "RUNNING", createdBy: fx.user.id, startedAt: new Date(),
    },
  });
}

beforeAll(async () => {
  fx = await createFixtures();
  campaign = await makeCampaign();
  registerDnsFixture("evil-rebind.test", ["203.0.113.99", "10.0.0.66"]);
  registerDnsFixture("public-only.test", ["203.0.113.50"]);
});

afterAll(async () => {
  resetRuntimeBudgets();
});

describe("policy gateway — happy path and core denials", () => {
  it("allows an authorized asset inside allow rules", async () => {
    const r = await authorizeEgress({
      orgId: fx.org.id, programId: fx.program.id, campaignId: campaign.id, jobRef: "job_t1",
      host: "shop.demo-target.test", path: "/index.html", method: "GET",
    });
    expect(r.decision).toBe("ALLOW");
    expect(r.resolvedIp).toBe("203.0.113.10");
  });

  it("denies the deny-listed host even when its asset row is (inconsistently) AUTHORIZED — deny overrides allow", async () => {
    // Simulate a data inconsistency: admin host marked AUTHORIZED although the
    // policy deny-lists it. The gateway must still refuse: the deny rule wins.
    await db.asset.update({ where: { id: fx.assetAdmin.id }, data: { scopeState: "AUTHORIZED" } });
    const r = await authorizeEgress({
      orgId: fx.org.id, programId: fx.program.id, campaignId: campaign.id, jobRef: "job_t2",
      host: "admin.demo-target.test", path: "/", method: "GET",
    });
    expect(r.decision).toBe("DENY");
    expect(r.code).toBe("OUT_OF_SCOPE");
    expect(r.reason).toContain("Deny rule");
  });

  it("denies a host with no allow rule even if authorized as an asset", async () => {
    await fx.addAsset("blog.demo-target.test", "AUTHORIZED");
    const r = await authorizeEgress({
      orgId: fx.org.id, programId: fx.program.id, campaignId: campaign.id, jobRef: "job_t3",
      host: "blog.demo-target.test", path: "/", method: "GET",
    });
    expect(r.decision).toBe("DENY");
  });

  it("denies a DISCOVERED asset (unverified assets never enter the active work queue)", async () => {
    const r = await authorizeEgress({
      orgId: fx.org.id, programId: fx.program.id, campaignId: campaign.id, jobRef: "job_t4",
      host: "staging.demo-target.test", path: "/", method: "GET",
    });
    expect(r.decision).toBe("DENY");
    expect(r.code).toBe("ASSET_NOT_AUTHORIZED");
  });

  it("denies hosts that are not assets of the program at all", async () => {
    const r = await authorizeEgress({
      orgId: fx.org.id, programId: fx.program.id, campaignId: campaign.id, jobRef: "job_t5",
      host: "totally-unknown.test", path: "/", method: "GET",
    });
    expect(r.decision).toBe("DENY");
    expect(r.code).toBe("ASSET_NOT_IN_PROGRAM");
  });

  it("denies when the campaign is not RUNNING", async () => {
    const stopped = await makeCampaign();
    await db.campaign.update({ where: { id: stopped.id }, data: { state: "STOPPED" } });
    const r = await authorizeEgress({
      orgId: fx.org.id, programId: fx.program.id, campaignId: stopped.id, jobRef: "job_t6",
      host: "shop.demo-target.test", path: "/", method: "GET",
    });
    expect(r.decision).toBe("DENY");
    expect(r.code).toBe("CAMPAIGN_NOT_RUNNING");
  });

  it("SSRF guard blocks private destinations before scope matching (authorized asset, private DNS)", async () => {
    // Register a fixture where an in-scope-style host resolves to a private IP.
    registerDnsFixture("private-shop.test", ["10.2.3.4"]);
    await fx.addAsset("private-shop.test", "AUTHORIZED");
    const r = await authorizeEgress({
      orgId: fx.org.id, programId: fx.program.id, campaignId: campaign.id, jobRef: "job_t7",
      host: "private-shop.test", path: "/", method: "GET",
    });
    expect(r.decision).toBe("DENY");
    expect(r.code).toBe("SSRF_GUARD"); // resolved-address guard fires before allow-rule matching
  });

  it("SSRF guard fires before scope matching for hosts in allow rules", async () => {
    // api.demo-target.test is allowed by rules; point its DNS at link-local.
    registerDnsFixture("api.demo-target.test", ["169.254.169.254"]);
    await fx.addAsset("api.demo-target.test", "AUTHORIZED");
    const r = await authorizeEgress({
      orgId: fx.org.id, programId: fx.program.id, campaignId: campaign.id, jobRef: "job_t8",
      host: "api.demo-target.test", path: "/v1/orders", method: "GET",
    });
    expect(r.decision).toBe("DENY");
    expect(r.code).toBe("SSRF_GUARD");
    registerDnsFixture("api.demo-target.test", ["203.0.113.11"]); // restore
  });
});

describe("policy gateway — revocation, emergency stop, budgets", () => {
  it("rejects everything for the program after revocation (POLICY_REVOKED semantics)", async () => {
    const local = await createFixtures();
    const c = await db.campaign.create({
      data: {
        id: newId("cmp"), orgId: local.org.id, programId: local.program.id, policyVersionId: local.policy.id,
        name: "rev test", mode: "PASSIVE_ONLY",
        budgetJson: JSON.stringify({ max_requests: 5, max_rps: 5, max_concurrency: 1 }),
        state: "RUNNING", createdBy: local.user.id,
      },
    });
    const allowBefore = await authorizeEgress({
      orgId: local.org.id, programId: local.program.id, campaignId: c.id, jobRef: "job_r1",
      host: "shop.demo-target.test", path: "/", method: "GET",
    });
    expect(allowBefore.decision).toBe("ALLOW");

    await db.scopeVersion.update({ where: { id: local.policy.id }, data: { status: "REVOKED", revokedAt: new Date() } });
    const r = await authorizeEgress({
      orgId: local.org.id, programId: local.program.id, campaignId: c.id, jobRef: "job_r2",
      host: "shop.demo-target.test", path: "/", method: "GET",
    });
    expect(r.decision).toBe("DENY");
    expect(r.code).toBe("NO_ACTIVE_POLICY"); // fail closed: no fallback to older versions
  });

  it("emergency stop blocks new operations and cancels queued jobs", async () => {
    const local = await createFixtures();
    const c = await db.campaign.create({
      data: {
        id: newId("cmp"), orgId: local.org.id, programId: local.program.id, policyVersionId: local.policy.id,
        name: "estop", mode: "PASSIVE_ONLY", budgetJson: JSON.stringify({ max_requests: 5, max_rps: 5, max_concurrency: 1 }),
        state: "RUNNING", createdBy: local.user.id,
      },
    });
    await db.job.create({
      data: { id: newId("job"), campaignId: c.id, kind: "active-probe", idempotencyKey: "k1", status: "QUEUED", requestJson: "{}" },
    });
    const result = await triggerEmergencyStop({ scope: "ORG", orgId: local.org.id, reason: "test stop", createdBy: local.user.id });
    expect(result.cancelledJobs).toBe(1);

    const r = await authorizeEgress({
      orgId: local.org.id, programId: local.program.id, campaignId: c.id, jobRef: "job_e1",
      host: "shop.demo-target.test", path: "/", method: "GET",
    });
    expect(r.decision).toBe("DENY");
    expect(r.code).toBe("EMERGENCY_STOP");
    const job = await db.job.findFirst({ where: { campaignId: c.id } });
    expect(job?.status).toBe("CANCELLED");
  });

  it("enforces the durable request budget", async () => {
    const local = await createFixtures(); // budget max_requests = 3
    const c = await db.campaign.create({
      data: {
        id: newId("cmp"), orgId: local.org.id, programId: local.program.id, policyVersionId: local.policy.id,
        name: "budget", mode: "PASSIVE_ONLY", budgetJson: JSON.stringify({ max_requests: 3, max_rps: 50, max_concurrency: 2 }),
        state: "RUNNING", createdBy: local.user.id,
      },
    });
    resetRuntimeBudgets();
    const decisions = [];
    for (let i = 0; i < 4; i++) {
      decisions.push(await authorizeEgress({
        orgId: local.org.id, programId: local.program.id, campaignId: c.id, jobRef: `job_b${i}`,
        host: "shop.demo-target.test", path: "/", method: "GET",
      }));
    }
    expect(decisions.filter((d) => d.decision === "ALLOW")).toHaveLength(3);
    const last = decisions[3];
    expect(last.decision).toBe("DENY");
    expect(last.code).toBe("BUDGET_EXHAUSTED");
  });

  it("fails closed for a program from the wrong tenant (no cross-tenant programs)", async () => {
    const local = await createFixtures();
    const otherOrg = await db.organization.create({
      data: { id: newId("org"), slug: `other-${newId("t").slice(-6)}`, name: "Other Org" },
    });
    const r = await authorizeEgress({
      orgId: otherOrg.id, programId: local.program.id, jobRef: "job_x1",
      host: "shop.demo-target.test", path: "/", method: "GET",
    });
    expect(r.decision).toBe("DENY");
    expect(r.code).toBe("NO_PROGRAM");
  });
});

describe("DNS rebinding / TOCTOU (resolved at egress point)", () => {
  it("flags a host whose DNS answer changes between authorization and connection", async () => {
    const first = authorizeEgress; // keep import referenced
    void first;
    // resolve once (public) then again (private) — revalidation must fail closed
    const r1 = await revalidateConnection("evil-rebind.test", "203.0.113.99");
    expect(r1.decision).toBe("ALLOW");
    // second resolve returns the private IP
    const r2 = await revalidateConnection("evil-rebind.test", "203.0.113.99");
    expect(r2.decision).toBe("DENY");
    expect(r2.code).toBe("REBINDING_SUSPECTED");
  });
});
