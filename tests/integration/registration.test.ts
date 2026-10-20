import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { newId } from "@/lib/ids";

// Exercises the real route handler (Next.js route handlers are plain
// functions: Request -> Response), including cookie set + throttle.

import { POST as register } from "@/app/api/auth/register/route";

function makeRequest(body: unknown, ip = "10.9.8.7"): Request {
  return new Request("http://127.0.0.1:3000/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

describe("self-service registration", () => {
  afterAll(() => {
    process.env.REGISTRATION_ENABLED = undefined;
  });

  it("creates an org-less account, sets a session cookie, and audits it", async () => {
    process.env.REGISTRATION_ENABLED = undefined; // default: enabled
    const email = `signup-${newId("t").slice(-8)}@test.test`;
    const res = await register(makeRequest({ name: "Sign Up", email, password: "Str0ngPassw0rd" }) as never);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.email).toBe(email);
    expect(body.active_org_id).toBeNull();
    expect(body.next).toBe("/onboarding");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("sgx_session=");
    expect(setCookie).toContain("HttpOnly");

    const user = await db.user.findUnique({ where: { email } });
    expect(user?.name).toBe("Sign Up");
    expect(user?.passwordHash.startsWith("scrypt$")).toBe(true); // never plaintext
    const audited = await db.auditEvent.findFirst({ where: { action: "auth.registered", resourceId: user!.id } });
    expect(audited).not.toBeNull();
  });

  it("rejects duplicate emails with 409 (no existence oracle beyond the form)", async () => {
    const email = `dup-${newId("t").slice(-8)}@test.test`;
    await register(makeRequest({ name: "First", email, password: "Str0ngPassw0rd" }, "10.1.1.1") as never);
    const res = await register(makeRequest({ name: "Second", email, password: "Str0ngPassw0rd" }, "10.1.1.2") as never);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("EMAIL_TAKEN");
  });

  it("enforces the password policy with 422", async () => {
    const res = await register(makeRequest({ name: "Weak", email: `weak-${Date.now()}@test.test`, password: "short" }, "10.2.2.2") as never);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("can be disabled by deployment policy (403) and throttles per IP (429)", async () => {
    process.env.REGISTRATION_ENABLED = "false";
    const off = await register(makeRequest({ name: "Off", email: `off-${Date.now()}@test.test`, password: "Str0ngPassw0rd" }, "10.3.3.3") as never);
    expect(off.status).toBe(403);
    process.env.REGISTRATION_ENABLED = undefined;

    const burst = "10.4.4.4";
    let last: Response | null = null;
    for (let i = 0; i < 7; i++) {
      last = await register(makeRequest({ name: "Burst", email: `burst-${i}-${Date.now()}@test.test`, password: "Str0ngPassw0rd" }, burst) as never);
    }
    expect(last!.status).toBe(429); // 6th+ attempt from the same IP within the hour
  });
});
