import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { newId } from "@/lib/ids";
import { hashPassword } from "@/lib/auth/password";
import { createFixtures } from "../helpers";

// Route-level tests need next/headers cookies() mocked (outside Next runtime).
const holders = vi.hoisted(() => ({ cookie: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      if (!holders.cookie) return undefined;
      const eq = holders.cookie.indexOf("=");
      const [n, v] = [holders.cookie.slice(0, eq), holders.cookie.slice(eq + 1)];
      return n === name ? { name, value: v } : undefined;
    },
  })),
}));

import { POST as activateAction } from "@/app/api/v1/scope-versions/[idAction]/route";

async function loginAs(userId: string, orgId: string | null): Promise<void> {
  const { createSession, SESSION_COOKIE } = await import("@/lib/auth/session");
  const token = await createSession(userId, orgId);
  holders.cookie = `${SESSION_COOKIE}=${token}`;
}

async function callActivate(svId: string): Promise<Response> {
  const req = new Request(`http://127.0.0.1:3000/api/v1/scope-versions/${svId}:activate`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: holders.cookie ?? "" },
    body: "{}",
  });
  return activateAction(req, { params: Promise.resolve({ idAction: `${svId}:activate` }) });
}

async function seedSoloOrg(version = 1) {
  const suffix = newId("t").slice(-8);
  const org = await db.organization.create({
    data: { id: newId("org"), slug: `solo-${suffix}`, name: `Solo ${suffix}` },
  });
  const user = await db.user.create({
    data: { id: newId("usr"), email: `solo-${suffix}@test.test`, name: "Solo Op", passwordHash: hashPassword("x") },
  });
  await db.membership.create({
    data: { id: newId("mem"), orgId: org.id, principalId: user.id, role: "TENANT_ADMIN" },
  });
  const program = await db.program.create({
    data: {
      id: newId("prg"), orgId: org.id, provider: "manual", handle: `solo-${suffix}`,
      name: `Solo Program ${suffix}`, authorizationRef: "test", state: "DRAFT", createdBy: user.id,
    },
  });
  const sv = await db.scopeVersion.create({
    data: {
      id: newId("spv"), programId: program.id, version,
      rulesJson: JSON.stringify({
        allow: [{ host: "shop.demo-target.test", paths: ["/"], methods: ["GET"] }],
        deny: [], budgets: { max_requests: 10, max_rps: 1, max_concurrency: 1 }, notes: "",
      }),
      status: "APPROVED", proposedBy: user.id, approvedBy: user.id,
    },
  });
  return { org, user, program, sv };
}

describe("policy activation — segregation of duties + solo operator", () => {
  it("multi-member org: the proposer CANNOT activate their own version (403 SELF_APPROVAL)", async () => {
    const fx = await createFixtures(); // has an ACTIVE v1 already
    await db.membership.create({
      data: { id: newId("mem"), orgId: fx.org.id, principalId: fx.user.id, role: "TENANT_ADMIN" },
    });
    const second = await db.user.create({
      data: { id: newId("usr"), email: `second-${newId("t").slice(-6)}@test.test`, name: "Second", passwordHash: hashPassword("x") },
    });
    await db.membership.create({ data: { id: newId("mem"), orgId: fx.org.id, principalId: second.id, role: "RESEARCHER" } });

    const sv = await db.scopeVersion.create({
      data: {
        id: newId("spv"), programId: fx.program.id, version: 2,
        rulesJson: fx.policy.rulesJson, status: "APPROVED", proposedBy: fx.user.id, approvedBy: fx.user.id,
      },
    });
    await loginAs(fx.user.id, fx.org.id);
    const res = await callActivate(sv.id);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("SELF_APPROVAL");
  });

  it("solo org: the single operator MAY self-activate (audited as policy.activated_solo)", async () => {
    const { org, user, sv } = await seedSoloOrg();
    await loginAs(user.id, org.id);
    const res = await callActivate(sv.id);
    expect(res.status).toBe(200);
    const after = await db.scopeVersion.findUnique({ where: { id: sv.id } });
    expect(after?.status).toBe("ACTIVE");
    const audited = await db.auditEvent.findFirst({ where: { action: "policy.activated_solo", resourceId: sv.id } });
    expect(audited).not.toBeNull();
    const program = await db.program.findUnique({ where: { id: sv.programId } });
    expect(program?.state).toBe("ACTIVE"); // program auto-activates with its policy
  });

  it("still validates stored rules before activation (422 on garbage)", async () => {
    const { org, user, program } = await seedSoloOrg();
    const sv = await db.scopeVersion.create({
      data: {
        id: newId("spv"), programId: program.id, version: 2,
        rulesJson: "{ not valid rules", status: "APPROVED", proposedBy: user.id, approvedBy: user.id,
      },
    });
    await loginAs(user.id, org.id);
    const res = await callActivate(sv.id);
    expect(res.status).toBe(422); // INVALID_RULES — stored rules must re-validate
  });
});
