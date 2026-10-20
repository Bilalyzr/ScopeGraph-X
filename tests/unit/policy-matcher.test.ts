import { describe, expect, it } from "vitest";
import { matchScope, explainMatch } from "@/lib/policy/matcher";
import type { ScopeRules } from "@/lib/policy/rules";

const rules: ScopeRules = {
  allow: [
    { host: "api.demo-target.test", paths: ["/v1/orders", "/v1/users"], methods: ["GET", "POST"] },
    { host: "*.demo-target.test", paths: ["/"], methods: ["GET"] },
  ],
  deny: [
    { host: "admin.demo-target.test", reason: "excluded" },
    { host: "api.demo-target.test", paths: ["/v1/admin"], reason: "admin surface excluded" },
  ],
  budgets: { max_requests: 100, max_rps: 2, max_concurrency: 1 },
  notes: "",
};

describe("scope matcher (FR-SCP-01: deny overrides allow)", () => {
  it("allows an in-scope host/path/method", () => {
    expect(matchScope(rules, { host: "api.demo-target.test", path: "/v1/orders", method: "GET" }).allowed).toBe(true);
  });

  it("DENIES when a deny rule matches even though a wildcard allow also matches (deny wins)", () => {
    // admin.demo-target.test matches *.demo-target.test allow AND the deny rule.
    const r = matchScope(rules, { host: "admin.demo-target.test", path: "/", method: "GET" });
    expect(r.allowed).toBe(false);
    expect(r.matchedDeny?.reason).toBe("excluded");
  });

  it("denies path explicitly excluded under an allowed host", () => {
    const r = matchScope(rules, { host: "api.demo-target.test", path: "/v1/admin/export", method: "GET" });
    expect(r.allowed).toBe(false);
    expect(r.matchedDeny?.host).toBe("api.demo-target.test");
  });

  it("denies disallowed methods on an allowed path", () => {
    expect(matchScope(rules, { host: "api.demo-target.test", path: "/v1/orders", method: "DELETE" }).allowed).toBe(false);
  });

  it("denies unknown hosts entirely (fail closed)", () => {
    const r = matchScope(rules, { host: "evil.example.com", path: "/", method: "GET" });
    expect(r.allowed).toBe(false);
    expect(r.matchedDeny).toBeUndefined();
  });

  it("denies hosts that merely share a suffix without a dot boundary", () => {
    expect(matchScope(rules, { host: "notdemo-target.test", path: "/", method: "GET" }).allowed).toBe(false);
    expect(matchScope(rules, { host: "x.evil-demo-target.test.suspicious.io", path: "/", method: "GET" }).allowed).toBe(false);
  });

  it("explains decisions for UI surfaces", () => {
    expect(explainMatch(rules, { host: "admin.demo-target.test", path: "/", method: "GET" })).toContain("Denied by rule");
    expect(explainMatch(rules, { host: "shop.demo-target.test", path: "/x", method: "GET" })).toContain("Allowed by rule");
  });
});
