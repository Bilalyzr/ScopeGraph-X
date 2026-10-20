import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { newId } from "@/lib/ids";
import { createFixtures } from "../helpers";
import { createFinding, transitionFinding } from "@/lib/findings/lifecycle";
import { storeEvidence, readEvidence } from "@/lib/evidence/store";
import { audit, verifyAuditChain } from "@/lib/audit";
import { neighbors } from "@/lib/graph/projection";
import { ApiError } from "@/lib/api";

describe("tenant isolation (FR-ENT-01: cross-tenant reads/writes rejected)", () => {
  it("evidence reads are tenant-scoped and integrity-checked", async () => {
    const a = await createFixtures();
    const b = await createFixtures();
    const { evidence } = await storeEvidence({
      orgId: a.org.id, createdBy: a.user.id, source: "test", content: { secret: false, data: "tenant-a" },
    });
    // Same tenant can read
    const own = await readEvidence(a.org.id, evidence.id);
    expect(own).not.toBeNull();
    expect(own!.content).toContain("tenant-a");
    // Cross-tenant read returns null (no existence leak)
    const cross = await readEvidence(b.org.id, evidence.id);
    expect(cross).toBeNull();
  });

  it("evidence deduplication is tenant-scoped (same content, different orgs)", async () => {
    const a = await createFixtures();
    const b = await createFixtures();
    const content = { shared: "payload", n: Math.floor(Math.random() * 1e9) };
    const first = await storeEvidence({ orgId: a.org.id, createdBy: a.user.id, source: "t", content });
    const sameOrg = await storeEvidence({ orgId: a.org.id, createdBy: a.user.id, source: "t", content });
    const otherOrg = await storeEvidence({ orgId: b.org.id, createdBy: b.user.id, source: "t", content });
    expect(sameOrg.deduplicated).toBe(true);
    expect(otherOrg.deduplicated).toBe(false);
    expect(first.evidence.id).not.toBe(otherOrg.evidence.id);
  });

  it("graph traversal never crosses tenants", async () => {
    const a = await createFixtures();
    const b = await createFixtures();
    // edge: a's asset IN_SCOPE_OF a's program
    const r1 = await neighbors(a.org.id, "Asset", a.assetShop.id, 1);
    expect(r1.nodes.some((n) => n.type === "Program")).toBe(true);
    // tenant B asks about tenant A's asset -> empty (not found FOR THEM)
    const r2 = await neighbors(b.org.id, "Asset", a.assetShop.id, 1);
    expect(r2.nodes).toHaveLength(0);
  });

  it("finding lifecycle rejects invalid transitions with typed errors", async () => {
    const a = await createFixtures();
    const f = await createFinding({
      orgId: a.org.id, programId: a.program.id, assetId: a.assetShop.id,
      category: "BOLA", title: `Cross-tenant order read ${newId("t").slice(-6)}`,
      description: "Test finding description long enough", severity: "HIGH", confidence: 0.5,
      actorId: a.user.id,
    });
    // Move to OBSERVED first (valid for APPSEC_LEAD), then verify the role gate:
    // REPRODUCED is a legal next transition but requires an independent validator.
    await transitionFinding({ findingId: f.id, orgId: a.org.id, to: "OBSERVED", role: "APPSEC_LEAD", actorId: a.user.id });
    await expect(
      transitionFinding({ findingId: f.id, orgId: a.org.id, to: "REPRODUCED", role: "RESEARCHER", actorId: a.user.id })
    ).rejects.toMatchObject({ status: 403 });
    // skip is invalid even for a validator
    await expect(
      transitionFinding({ findingId: f.id, orgId: a.org.id, to: "REPORTED", role: "VALIDATOR", actorId: a.user.id })
    ).rejects.toMatchObject({ status: 422 });
    // cross-tenant transition attempt: 404
    const b = await createFixtures();
    await expect(
      transitionFinding({ findingId: f.id, orgId: b.org.id, to: "OBSERVED", role: "APPSEC_LEAD", actorId: b.user.id })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("duplicate findings are rejected by fingerprint", async () => {
    const a = await createFixtures();
    const title = `Dup test ${newId("t").slice(-6)}`;
    await createFinding({
      orgId: a.org.id, programId: a.program.id, category: "BOLA", title,
      description: "first", severity: "HIGH", confidence: 0.5, actorId: a.user.id,
    });
    await expect(
      createFinding({
        orgId: a.org.id, programId: a.program.id, category: "BOLA", title,
        description: "second", severity: "HIGH", confidence: 0.5, actorId: a.user.id,
      })
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("audit chain integrity (tamper-evident)", () => {
  it("verifies clean and detects tampering", async () => {
    const a = await createFixtures();
    await audit({ orgId: a.org.id, actorId: a.user.id, action: "test.event", resourceType: "Test", resourceId: "r1", decision: "ALLOW" });
    await audit({ orgId: a.org.id, actorId: a.user.id, action: "test.event2", resourceType: "Test", resourceId: "r2", decision: "DENY" });
    expect((await verifyAuditChain()).ok).toBe(true);

    // Tamper with the last event's reason and expect the chain to break.
    const last = await db.auditEvent.findFirst({ orderBy: { seq: "desc" } });
    await db.auditEvent.update({ where: { id: last!.id }, data: { reason: "TAMPERED" } });
    const broken = await verifyAuditChain();
    expect(broken.ok).toBe(false);
    expect(broken.brokenAt).toBe(last!.id);
    // restore for other tests
    await db.auditEvent.update({ where: { id: last!.id }, data: { reason: last!.reason } });
  });
});
