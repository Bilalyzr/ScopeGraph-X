import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { newId } from "@/lib/ids";
import { importExternalFindings } from "@/lib/detection/sast";
import { runInvariantCheck } from "@/lib/detection/invariants";
import { createFinding } from "@/lib/findings/lifecycle";
import { createFixtures } from "../helpers";

const MACHINE = {
  initialState: "CART",
  terminalStates: ["FULFILLED", "CANCELLED"],
  transitions: [
    { from: "CART", to: "CHECKOUT" },
    { from: "CHECKOUT", to: "PAID", guard: "payment" },
    { from: "PAID", to: "FULFILLED" },
  ],
  idempotentOperations: ["submitPayment"],
  recorded: [
    { operation: "beginCheckout", from: "CART", to: "CHECKOUT" },
    { operation: "submitPayment", from: "CHECKOUT", to: "PAID", firstOutcome: "t1", replayOutcome: "t2" },
    { operation: "forceFulfill", from: "PAID", to: "FULFILLED" },
  ],
};

async function seedResource(fx: Awaited<ReturnType<typeof createFixtures>>) {
  return db.resource.create({
    data: {
      id: newId("res"), programId: fx.program.id, objectType: "order_workflow",
      fixtureRef: "fixture://disposable/x", invariantJson: JSON.stringify(MACHINE),
    },
  });
}

describe("invariant engine end-to-end (FR-DET-03)", () => {
  it("flags violations and creates a CANDIDATE finding with evidence", async () => {
    const fx = await createFixtures();
    const resource = await seedResource(fx);
    const result = await runInvariantCheck(resource.id, fx.user.id);

    expect(result.run.status).toBe("VIOLATIONS_FOUND");
    expect(result.violations.length).toBe(1); // non-idempotent submitPayment (PAID→FULFILLED IS approved)
    expect(result.violations[0].kind).toBe("NON_IDEMPOTENT_OPERATION");
    expect(result.findingId).toBeDefined();

    const finding = await db.finding.findUnique({ where: { id: result.findingId! } });
    expect(finding?.status).toBe("PROPOSED"); // candidate, never auto-confirmed
    expect(finding?.category).toBe("WORKFLOW_VIOLATION");
    const evidenceLinks = await db.findingEvidence.findMany({ where: { findingId: finding!.id } });
    expect(evidenceLinks).toHaveLength(1);
  });

  it("clean machine replay reports zero violations and no finding", async () => {
    const fx = await createFixtures();
    const clean = { ...MACHINE, recorded: MACHINE.recorded.slice(0, 2).map((r) => ({ ...r, firstOutcome: "t1", replayOutcome: "t1" })) };
    const resource = await db.resource.create({
      data: { id: newId("res"), programId: fx.program.id, objectType: "wf", invariantJson: JSON.stringify(clean) },
    });
    const result = await runInvariantCheck(resource.id, fx.user.id);
    expect(result.run.status).toBe("COMPLETED");
    expect(result.violations).toHaveLength(0);
    expect(result.findingId).toBeUndefined();
  });

  it("requires an invariant definition", async () => {
    const fx = await createFixtures();
    const resource = await db.resource.create({
      data: { id: newId("res"), programId: fx.program.id, objectType: "wf", invariantJson: JSON.stringify({}) },
    });
    await expect(runInvariantCheck(resource.id, fx.user.id)).rejects.toThrow("NO_INVARIANT_DEFINED");
  });
});

describe("SAST/SCA ↔ runtime correlation (FR-DET-04)", () => {
  it("links by asset + rule overlap and NEVER confirms the runtime finding", async () => {
    const fx = await createFixtures();
    // Runtime finding on ast_shop with a scanner-ish category
    const runtime = await createFinding({
      orgId: fx.org.id, programId: fx.program.id, assetId: fx.assetShop.id,
      category: "scanner:demo-misconfig-x", title: `Runtime ${newId("t").slice(-6)}`,
      description: "runtime observation", severity: "MEDIUM", confidence: 0.4, actorId: fx.user.id,
      sourceDetector: "nuclei-mock",
    });
    expect(runtime.status).toBe("PROPOSED");

    const result = await importExternalFindings(fx.program.id, fx.org.id, fx.user.id, [
      { tool: "sast", rule: "demo-misconfig-x", locator: "src/App.java:12", cwe: "CWE-16", severity: "MEDIUM", asset_locator: fx.assetShop.canonicalLocator },
      { tool: "sca", rule: "CVE-2026-99999", locator: "lib@1.0.0", asset_locator: fx.assetAdmin.canonicalLocator },
    ]);

    expect(result.imported).toBe(2);
    expect(result.correlated).toBe(1); // SAST row linked; SCA row has no matching runtime finding
    const linked = await db.externalFinding.findUnique({ where: { id: result.externalIds[0] } });
    expect(linked?.correlatedFindingId).toBe(runtime.id);
    expect(linked?.correlationStatus).toBe("CORRELATED_UNCONFIRMED");

    // The runtime finding's status/validation is untouched by correlation.
    const after = await db.finding.findUnique({ where: { id: runtime.id } });
    expect(after?.status).toBe("PROPOSED");
    expect(after?.validationStatus).toBe("UNVALIDATED");
  });

  it("tenant-scopes external findings", async () => {
    const a = await createFixtures();
    const b = await createFixtures();
    const result = await importExternalFindings(a.program.id, a.org.id, a.user.id, [
      { tool: "sca", rule: "R1" },
    ]);
    const inB = await db.externalFinding.findMany({ where: { orgId: b.org.id } });
    expect(result.imported).toBe(1);
    expect(inB).toHaveLength(0);
  });
});
