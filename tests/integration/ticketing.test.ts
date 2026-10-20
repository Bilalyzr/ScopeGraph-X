import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createFixtures } from "../helpers";
import { createFinding, transitionFinding } from "@/lib/findings/lifecycle";
import { syncFindingToTicket, ticketingMode, buildTicketPayload } from "@/lib/ticketing";

describe("ticketing sync (FR-ENT-02)", () => {
  beforeAll(() => {
    process.env.TICKETING_PROVIDER = "recorder";
  });
  afterAll(() => {
    process.env.TICKETING_PROVIDER = "none";
  });

  it("mode resolves from env and fails safe", () => {
    expect(ticketingMode()).toBe("recorder");
    process.env.TICKETING_PROVIDER = "jira"; // missing credentials -> falls back
    expect(ticketingMode()).toBe("none");
    process.env.TICKETING_PROVIDER = "recorder";
  });

  it("REPORTED transition creates exactly one linked ticket (idempotent)", async () => {
    const fx = await createFixtures();
    const finding = await createFinding({
      orgId: fx.org.id, programId: fx.program.id, assetId: fx.assetShop.id,
      category: "BOLA", title: `Ticketed ${Date.now()}`, description: "ticket sync test finding",
      severity: "HIGH", confidence: 0.6, actorId: fx.user.id,
    });
    // Validation gate: REPORTED requires a validator decision first.
    await db.finding.update({ where: { id: finding.id }, data: { validationStatus: "VALIDATED", validatedBy: fx.user.id } });
    await transitionFinding({ findingId: finding.id, orgId: fx.org.id, to: "OBSERVED", role: "APPSEC_LEAD", actorId: fx.user.id });
    await transitionFinding({ findingId: finding.id, orgId: fx.org.id, to: "REPRODUCED", role: "VALIDATOR", actorId: fx.user.id });
    await transitionFinding({ findingId: finding.id, orgId: fx.org.id, to: "REVIEWED", role: "VALIDATOR", actorId: fx.user.id });
    await transitionFinding({ findingId: finding.id, orgId: fx.org.id, to: "REPORTED", role: "APPSEC_LEAD", actorId: fx.user.id });

    const links = await db.ticketLink.findMany({ where: { findingId: finding.id } });
    expect(links).toHaveLength(1);
    expect(links[0].issueKey).toMatch(/^REC-/);

    // Re-running the sync must not create a second ticket.
    const again = await syncFindingToTicket({ ...finding, status: "REPORTED" } as never);
    expect(again.created).toBe(false);
    expect(again.issueKey).toBe(links[0].issueKey);
    expect(await db.ticketLink.count({ where: { findingId: finding.id } })).toBe(1);
  });

  it("ticket payload is sanitized and severity-labelled", async () => {
    const fx = await createFixtures();
    const finding = await createFinding({
      orgId: fx.org.id, programId: fx.program.id,
      category: "scanner:demo", title: `Payload ${Date.now()}`,
      description: "desc", severity: "MEDIUM", confidence: 0.3, actorId: fx.user.id,
    });
    const payload = buildTicketPayload(finding, "http://127.0.0.1:3000");
    expect(payload.summary).toContain("[MEDIUM]");
    expect(payload.labels).toContain("scopegraph-x");
    expect(payload.labels).toContain("severity-medium");
    expect(payload.description).toContain(finding.id);
    expect(payload.findingUrl).toContain(`/findings/${finding.id}`);
  });

  it("disabled mode reports TICKETING_DISABLED and links nothing", async () => {
    process.env.TICKETING_PROVIDER = "none";
    const fx = await createFixtures();
    const finding = await createFinding({
      orgId: fx.org.id, programId: fx.program.id,
      category: "BOLA", title: `Disabled ${Date.now()}`, description: "x",
      severity: "LOW", confidence: 0.2, actorId: fx.user.id,
    });
    const res = await syncFindingToTicket(finding);
    expect(res.error).toBe("TICKETING_DISABLED");
    expect(await db.ticketLink.count({ where: { findingId: finding.id } })).toBe(0);
    process.env.TICKETING_PROVIDER = "recorder";
  });
});
