import { db } from "@/lib/db";
import { newId } from "@/lib/ids";
import { hashPassword } from "@/lib/auth/password";
import { addEdge } from "@/lib/graph/projection";

/** Shared fixtures for integration tests (fresh per call to avoid inter-test coupling). */
export async function createFixtures(opts?: { otherOrg?: boolean }) {
  const suffix = newId("t").slice(-8);
  const org = await db.organization.create({
    data: { id: newId("org"), slug: `test-org-${suffix}`, name: `Test Org ${suffix}` },
  });
  const user = await db.user.create({
    data: { id: newId("usr"), email: `user-${suffix}@test.test`, name: "Test User", passwordHash: hashPassword("x") },
  });
  const program = await db.program.create({
    data: {
      id: newId("prg"), orgId: org.id, provider: "manual", handle: `prog-${suffix}`,
      name: `Program ${suffix}`, authorizationRef: "test-auth-ref", state: "ACTIVE", createdBy: user.id,
    },
  });
  const rules = {
    allow: [
      { host: "shop.demo-target.test", paths: ["/"], methods: ["GET"] },
      { host: "api.demo-target.test", paths: ["/v1/orders"], methods: ["GET"] },
    ],
    deny: [{ host: "admin.demo-target.test", reason: "excluded" }],
    budgets: { max_requests: 3, max_rps: 10, max_concurrency: 2 },
    notes: "",
  };
  const policy = await db.scopeVersion.create({
    data: {
      id: newId("spv"), programId: program.id, version: 1, rulesJson: JSON.stringify(rules),
      status: "ACTIVE", proposedBy: user.id, approvedBy: user.id, activatedAt: new Date(),
    },
  });
  async function addAsset(locator: string, scopeState: string) {
    return db.asset.create({
      data: {
        id: newId("ast"), orgId: org.id, programId: program.id, canonicalLocator: locator,
        assetType: "HOST", scopeState, confidence: 0.9,
      },
    });
  }
  const assetShop = await addAsset("shop.demo-target.test", "AUTHORIZED");
  const assetAdmin = await addAsset("admin.demo-target.test", "DENIED");
  const assetStaging = await addAsset("staging.demo-target.test", "DISCOVERED");
  await addEdge({
    orgId: org.id, sourceType: "Asset", sourceId: assetShop.id, relation: "IN_SCOPE_OF",
    targetType: "Program", targetId: program.id, confidence: 0.9, policyContext: "test",
  });
  return { org, user, program, policy, rules, assetShop, assetAdmin, assetStaging, addAsset };
}
