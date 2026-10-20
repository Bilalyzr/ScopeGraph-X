import { describe, expect, it } from "vitest";
import { parseOpenApiDocument, normalizeRoute } from "@/lib/detection/openapi";
import { checkInvariants, validateMachine, type StateMachine, type RecordedTransition } from "@/lib/detection/invariants";

describe("OpenAPI import normalization (FR-REC-02)", () => {
  const doc = {
    openapi: "3.1.0",
    info: { title: "orders", version: "2.0.0" },
    paths: {
      "/v1/orders": { get: { operationId: "list" }, post: { operationId: "create" } },
      "/v1/orders/{id}": { get: {}, delete: {} },
      "/v1/users/:userId": { get: {} },
    },
  };

  it("extracts every operation with normalized routes", () => {
    const parsed = parseOpenApiDocument(doc);
    expect(parsed.title).toBe("orders");
    expect(parsed.endpoints).toHaveLength(5);
    expect(parsed.endpoints.map((e) => `${e.method} ${e.routeTemplate}`).sort()).toEqual([
      "DELETE /v1/orders/{id}", "GET /v1/orders", "GET /v1/orders/{id}", "GET /v1/users/{userId}", "POST /v1/orders",
    ]);
  });

  it("normalizes colon-style params and strips trailing slashes", () => {
    expect(normalizeRoute("/v1/users/:userId")).toBe("/v1/users/{userId}");
    expect(normalizeRoute("health/")).toBe("/health");
    expect(normalizeRoute("/a/<id>")).toBe("/a/{id}");
  });

  it("rejects non-OpenAPI documents", () => {
    expect(() => parseOpenApiDocument({ hello: "world" })).toThrow();
  });
});

describe("workflow-invariant engine (FR-DET-03)", () => {
  const machine: StateMachine = {
    initialState: "CART",
    terminalStates: ["FULFILLED", "CANCELLED"],
    transitions: [
      { from: "CART", to: "CHECKOUT" },
      { from: "CHECKOUT", to: "PAID", guard: "payment" },
      { from: "PAID", to: "FULFILLED" },
      { from: "CART", to: "CANCELLED" },
    ],
    idempotentOperations: ["submitPayment"],
  };

  it("accepts a conforming transition sequence", () => {
    const recorded: RecordedTransition[] = [
      { operation: "beginCheckout", from: "CART", to: "CHECKOUT" },
      { operation: "submitPayment", from: "CHECKOUT", to: "PAID", firstOutcome: "t1", replayOutcome: "t1" },
      { operation: "fulfill", from: "PAID", to: "FULFILLED" },
    ];
    expect(checkInvariants(machine, recorded)).toHaveLength(0);
  });

  it("flags an illegal transition (state skip)", () => {
    const recorded: RecordedTransition[] = [
      { operation: "beginCheckout", from: "CART", to: "CHECKOUT" },
      { operation: "forceFulfill", from: "CHECKOUT", to: "FULFILLED" }, // not in approved graph
    ];
    const violations = checkInvariants(machine, recorded);
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe("ILLEGAL_TRANSITION");
    expect(violations[0].detail).toContain("not in the analyst-approved");
  });

  it("flags a non-idempotent operation marked idempotent", () => {
    const recorded: RecordedTransition[] = [
      { operation: "submitPayment", from: "CART", to: "CHECKOUT", firstOutcome: "txn_1", replayOutcome: "txn_2" },
    ];
    const violations = checkInvariants(machine, recorded);
    expect(violations.some((v) => v.kind === "NON_IDEMPOTENT_OPERATION")).toBe(true);
  });

  it("flags hidden/skipped transitions when 'from' does not track the machine", () => {
    const recorded: RecordedTransition[] = [{ operation: "mystery", from: "PAID", to: "FULFILLED" }];
    const violations = checkInvariants(machine, recorded);
    expect(violations.some((v) => v.detail.includes("does not match expected current state"))).toBe(true);
  });

  it("validates machine definitions", () => {
    expect(validateMachine(machine)).toHaveLength(0);
    expect(validateMachine({ ...machine, terminalStates: [] }).length).toBeGreaterThan(0);
    expect(validateMachine({ ...machine, transitions: [...machine.transitions, { from: "X", to: "X" }] }).length).toBeGreaterThan(0);
  });
});
