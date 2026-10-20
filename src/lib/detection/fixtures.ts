// Synthetic authorization fixtures (FR-DET-02) — a locally simulated test
// application with two provisioned test identities and a defined expected
// access matrix. The differential analyzer compares EXPECTED vs OBSERVED
// authorization decisions; an HTTP 200 alone is never treated as proof.

export interface TestIdentity {
  identityId: string;
  roleLabel: string; // e.g. customer-support, billing-admin
  tenantLabel: string;
}

export const TEST_IDENTITIES: TestIdentity[] = [
  { identityId: "idt_support", roleLabel: "support-agent", tenantLabel: "tenant-a" },
  { identityId: "idt_billing", roleLabel: "billing-admin", tenantLabel: "tenant-a" },
];

export interface FixtureResource {
  objectType: string;
  resourceId: string;
  ownerTenant: string;
  /** Expected access matrix: identityId -> whether access SHOULD be granted. */
  expectedAccess: Record<string, boolean>;
  /** Simulated observed decisions: identityId -> actual HTTP result. */
  observed: Record<string, { status: number; bodyPreview: string }>;
}

/**
 * DEMO fixtures for api.demo-target.test. Two seeded weaknesses:
 *  - /v1/orders/{id} BOLA: support-agent CAN read another tenant's order (200) though expected DENY.
 *  - /v1/admin/export BFLA: support-agent (non-admin) can call an admin function (200) though expected DENY.
 * Also includes a NEGATIVE control: an endpoint where 200 is EXPECTED — the
 * analyzer must NOT report it (guards against "200 = vulnerable" logic).
 */
export const FIXTURES: FixtureResource[] = [
  {
    objectType: "order",
    resourceId: "ord_1001",
    ownerTenant: "tenant-b",
    expectedAccess: { idt_support: false, idt_billing: true },
    observed: {
      idt_support: { status: 200, bodyPreview: '{"order_id":"ord_1001","tenant":"tenant-b","total":499.00}' },
      idt_billing: { status: 200, bodyPreview: '{"order_id":"ord_1001","tenant":"tenant-b","total":499.00}' },
    },
  },
  {
    objectType: "admin_function",
    resourceId: "admin_export",
    ownerTenant: "platform",
    expectedAccess: { idt_support: false, idt_billing: false },
    observed: {
      idt_support: { status: 200, bodyPreview: '{"export":"started","rows":15000}' },
      idt_billing: { status: 403, bodyPreview: '{"error":"forbidden"}' },
    },
  },
  {
    objectType: "order",
    resourceId: "ord_1002",
    ownerTenant: "tenant-a",
    expectedAccess: { idt_support: true, idt_billing: true },
    observed: {
      idt_support: { status: 200, bodyPreview: '{"order_id":"ord_1002","tenant":"tenant-a","total":129.00}' },
      idt_billing: { status: 200, bodyPreview: '{"order_id":"ord_1002","tenant":"tenant-a","total":129.00}' },
    },
  },
];

export interface DifferentialFindingCandidate {
  category: "BOLA" | "BFLA";
  resourceType: string;
  resourceId: string;
  identity: TestIdentity;
  expected: boolean;
  observedStatus: number;
  evidence: { expectedAccess: unknown; observedResponse: unknown };
  negativeControl: boolean;
}

/**
 * Differential authorization analysis. Reports a candidate ONLY when expected
 * DENY but observed 2xx — and tags each with whether it is a negative control.
 */
export function analyzeDifferentialAuthorization(fixtures: FixtureResource[] = FIXTURES): DifferentialFindingCandidate[] {
  const candidates: DifferentialFindingCandidate[] = [];
  for (const fx of fixtures) {
    for (const identity of TEST_IDENTITIES) {
      const expected = fx.expectedAccess[identity.identityId];
      const observed = fx.observed[identity.identityId];
      if (expected === undefined || !observed) continue;
      const observedGranted = observed.status >= 200 && observed.status < 300;
      if (!expected && observedGranted) {
        candidates.push({
          category: fx.objectType === "admin_function" ? "BFLA" : "BOLA",
          resourceType: fx.objectType,
          resourceId: fx.resourceId,
          identity,
          expected,
          observedStatus: observed.status,
          evidence: { expectedAccess: fx.expectedAccess, observedResponse: observed },
          negativeControl: false,
        });
      }
    }
  }
  return candidates;
}
