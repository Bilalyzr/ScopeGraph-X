/**
 * Development seed — SYNTHETIC DEMONSTRATION DATA ONLY.
 * No real credentials, no real third-party targets. All hosts use reserved
 * documentation domains (*.demo-target.test / *.test) and documentation IPs.
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password";
import { newId } from "../src/lib/ids";
import { storeEvidence } from "../src/lib/evidence/store";
import { createFinding } from "../src/lib/findings/lifecycle";
import { analyzeDifferentialAuthorization } from "../src/lib/detection/fixtures";
import { mockNucleiResults } from "../src/lib/detection/scanner-adapter";
import { addEdge } from "../src/lib/graph/projection";
import { audit } from "../src/lib/audit";

const db = new PrismaClient();

const DEMO_PASSWORD = "Demo1234!";

async function main() {
  console.log("Seeding ScopeGraph X demo data …");

  // --- Organizations -----------------------------------------------------
  const acme = await db.organization.upsert({
    where: { slug: "acme-security-labs" },
    update: {},
    create: { id: "org_acme", slug: "acme-security-labs", name: "Acme Security Labs", region: "eu-central" },
  });
  const globex = await db.organization.upsert({
    where: { slug: "globex-appsec" },
    update: {},
    create: { id: "org_globex", slug: "globex-appsec", name: "Globex AppSec", region: "us-east" },
  });

  // --- Users & memberships (same password for every demo account) --------
  const users = [
    { id: "usr_researcher", email: "researcher@demo.test", name: "Riley Researcher", memberships: [{ org: acme.id, role: "RESEARCHER" }] },
    { id: "usr_lead", email: "lead@demo.test", name: "Lena Lead", memberships: [{ org: acme.id, role: "APPSEC_LEAD" }, { org: acme.id, role: null }] },
    { id: "usr_owner", email: "owner@demo.test", name: "Oscar Owner", memberships: [{ org: acme.id, role: "PROGRAM_OWNER" }] },
    { id: "usr_validator", email: "validator@demo.test", name: "Vera Validator", memberships: [{ org: acme.id, role: "VALIDATOR" }] },
    { id: "usr_admin", email: "admin@demo.test", name: "Ada Admin", memberships: [{ org: acme.id, role: "TENANT_ADMIN" }] },
    { id: "usr_auditor", email: "auditor@demo.test", name: "Arnold Auditor", memberships: [{ org: acme.id, role: "AUDITOR" }] },
    { id: "usr_globex", email: "globex@demo.test", name: "Greta Globex", memberships: [{ org: globex.id, role: "TENANT_ADMIN" }] },
  ];
  const passwordHash = hashPassword(DEMO_PASSWORD);
  for (const u of users) {
    await db.user.upsert({ where: { email: u.email }, update: {}, create: { id: u.id, email: u.email, name: u.name, passwordHash } });
    for (const m of u.memberships) {
      if (!m.role) continue;
      await db.membership.upsert({
        where: { orgId_principalId: { orgId: m.org, principalId: u.id } },
        update: { role: m.role },
        create: { id: newId("mem"), orgId: m.org, principalId: u.id, role: m.role },
      });
    }
  }

  // --- Program + scope policy --------------------------------------------
  const program = await db.program.upsert({
    where: { orgId_provider_handle: { orgId: acme.id, provider: "manual", handle: "demo-retail" } },
    update: {},
    create: {
      id: "prg_demo_retail", orgId: acme.id, provider: "manual", handle: "demo-retail",
      name: "Demo Retail Platform", description: "Synthetic demo program covering *.demo-target.test fixtures.",
      authorizationRef: "engagement-contract-2026-042", state: "ACTIVE", createdBy: "usr_lead",
    },
  });

  const rules = {
    allow: [
      { host: "shop.demo-target.test", paths: ["/"], methods: ["GET"] },
      { host: "api.demo-target.test", paths: ["/v1/orders", "/v1/users"], methods: ["GET", "POST"] },
    ],
    deny: [
      { host: "admin.demo-target.test", reason: "Explicitly excluded by program policy" },
      { host: "*.internal.test", reason: "Internal hosts are never in scope" },
    ],
    budgets: { max_requests: 500, max_rps: 2, max_concurrency: 2 },
    notes: "Initial policy from engagement contract 2026-042 (DEMO fixture).",
  };
  const scope = await db.scopeVersion.upsert({
    where: { programId_version: { programId: program.id, version: 1 } },
    update: {},
    create: {
      id: "spv_demo_v1", programId: program.id, version: 1,
      rulesJson: JSON.stringify(rules), note: "Initial import", provenance: "engagement-contract-2026-042",
      status: "ACTIVE", proposedBy: "usr_researcher", approvedBy: "usr_owner", activatedAt: new Date(),
    },
  });

  // --- Assets (scope states show the authorization ladder) ---------------
  const assets = [
    { id: "ast_shop", locator: "shop.demo-target.test", type: "HOST", state: "AUTHORIZED", note: "Ownership verified via DNS TXT; authorized in contract §2", conf: 0.95 },
    { id: "ast_api", locator: "api.demo-target.test", type: "API", state: "AUTHORIZED", note: "Ownership verified via DNS TXT; authorized in contract §2", conf: 0.95 },
    { id: "ast_admin", locator: "admin.demo-target.test", type: "HOST", state: "DENIED", note: "Excluded by program policy", conf: 0.9 },
    { id: "ast_staging", locator: "staging.demo-target.test", type: "HOST", state: "DISCOVERED", note: "CT log association only — NOT authorized", conf: 0.7 },
    { id: "ast_domain", locator: "demo-target.test", type: "DOMAIN", state: "ASSOCIATED", note: "RDAP association", conf: 0.85 },
  ];
  for (const a of assets) {
    await db.asset.upsert({
      where: { programId_canonicalLocator_assetType: { programId: program.id, canonicalLocator: a.locator, assetType: a.type } },
      update: {},
      create: {
        id: a.id, orgId: acme.id, programId: program.id, canonicalLocator: a.locator,
        assetType: a.type, displayName: a.locator, scopeState: a.state,
        authorizationNote: a.note, confidence: a.conf,
      },
    });
    await db.assetObservation.create({
      data: {
        id: newId("aob"), assetId: a.id, source: a.type === "DOMAIN" ? "rdap" : "dns",
        confidence: a.conf, payloadJson: JSON.stringify({ seeded: true, demo: true }),
        note: "Seeded observation (DEMO)",
      },
    });
    await addEdge({
      orgId: acme.id, sourceType: "Asset", sourceId: a.id, relation: "IN_SCOPE_OF",
      targetType: "Program", targetId: program.id, confidence: a.conf,
      policyContext: `scope-state:${a.state}`,
    });
  }

  // --- Endpoints + graph ---------------------------------------------------
  const endpoints = [
    { id: "ep_orders", assetId: "ast_api", method: "GET", route: "/v1/orders" },
    { id: "ep_users", assetId: "ast_api", method: "GET", route: "/v1/users/{id}" },
    { id: "ep_export", assetId: "ast_api", method: "POST", route: "/v1/admin/export" },
    { id: "ep_shop_root", assetId: "ast_shop", method: "GET", route: "/" },
  ];
  for (const ep of endpoints) {
    await db.endpoint.upsert({
      where: { assetId_method_routeTemplate: { assetId: ep.assetId, method: ep.method, routeTemplate: ep.route } },
      update: {},
      create: { id: ep.id, assetId: ep.assetId, method: ep.method, routeTemplate: ep.route },
    });
    await addEdge({
      orgId: acme.id, sourceType: "Asset", sourceId: ep.assetId, relation: "EXPOSES",
      targetType: "Endpoint", targetId: ep.id, confidence: 0.9, policyContext: "seed",
    });
  }

  // --- Test identities (vault references only) ----------------------------
  for (const [id, role, tenant] of [["idt_support", "support-agent", "tenant-a"], ["idt_billing", "billing-admin", "tenant-a"]] as const) {
    const existing = await db.identity.findFirst({ where: { orgId: acme.id, roleLabel: role } });
    if (!existing) {
      await db.identity.create({
        data: {
          id, orgId: acme.id, programId: program.id, roleLabel: role, tenantLabel: tenant,
          kind: "RESEARCHER_OWNED", secretRef: `vault://demo/${id}`,
        },
      });
    }
  }

  // --- Completed campaign with durable job history ------------------------
  const campaignId = "cmp_demo_passive";
  const existingCampaign = await db.campaign.findUnique({ where: { id: campaignId } });
  if (!existingCampaign) {
    await db.campaign.create({
      data: {
        id: campaignId, orgId: acme.id, programId: program.id, policyVersionId: scope.id,
        name: "Initial passive sweep (DEMO)", mode: "PASSIVE_ONLY",
        budgetJson: JSON.stringify({ max_requests: 100, max_rps: 1, max_concurrency: 1 }),
        state: "COMPLETED", createdBy: "usr_researcher", startedAt: new Date(), finishedAt: new Date(),
      },
    });
    await db.job.create({
      data: {
        id: "job_demo_passive", campaignId, kind: "passive-discovery", idempotencyKey: "passive-1",
        status: "SUCCEEDED", requestJson: "{}",
        resultJson: JSON.stringify({ observations: 5, newAssets: 0, mode: "mock" }),
      },
    });
    await db.job.create({
      data: {
        id: "job_demo_scanner", campaignId, kind: "scanner-import", idempotencyKey: "scanner-1",
        status: "SUCCEEDED", requestJson: "{}",
        resultJson: JSON.stringify({ adapter: "nuclei-mock", imported: 2 }),
      },
    });
  }

  // --- Findings from fixtures (candidates only) ---------------------------
  const existingFinding = await db.finding.findFirst({ where: { programId: program.id } });
  if (!existingFinding) {
    for (const c of analyzeDifferentialAuthorization()) {
      const { evidence } = await storeEvidence({
        orgId: acme.id, createdBy: "usr_researcher", source: "differential-fixture",
        content: {
          resource: `${c.resourceType}/${c.resourceId}`, identity: c.identity.identityId,
          expected_access: c.expected, observed_status: c.observedStatus, ...c.evidence,
        },
      });
      await createFinding({
        orgId: acme.id, programId: program.id, assetId: "ast_api",
        category: c.category,
        title: `${c.category}: ${c.identity.roleLabel} can access ${c.resourceType} ${c.resourceId} across tenant boundary`,
        description: `Differential analysis on seeded fixtures: expected access=${c.expected}, observed HTTP ${c.observedStatus}. Candidate only — independent validation required. (DEMO fixture finding)`,
        severity: "HIGH", confidence: 0.6,
        expectedBehavior: `Access denied for identity ${c.identity.identityId}`,
        observedBehavior: `HTTP ${c.observedStatus} with data`,
        impact: c.category === "BOLA" ? "Cross-tenant read of order records" : "Admin function callable by non-admin",
        limitations: "Synthetic fixture; reproduce against approved staging",
        remediation: "Enforce object/function-level authorization in the handler",
        reproductionSteps: [`Use identity ${c.identity.identityId}`, `Request ${c.resourceType} ${c.resourceId}`, "Compare with access matrix"],
        evidenceRefs: [{ evidenceId: evidence.id, role: "primary" }],
        actorId: "usr_researcher", sourceDetector: "differential-auth",
      });
    }
    // Scanner candidate (from mock adapter output)
    const matched = mockNucleiResults().filter((r) => r.matcher_status)[0];
    const { evidence } = await storeEvidence({
      orgId: acme.id, createdBy: "scanner-adapter:nuclei-mock", source: "scanner:nuclei-mock",
      content: { template_id: matched.template_id, matched_at: matched.matched_at, raw_response_excerpt: matched.raw_response_excerpt },
    });
    await createFinding({
      orgId: acme.id, programId: program.id, assetId: "ast_api",
      category: `scanner:${matched.template_id}`,
      title: matched.name,
      description: `Mock scanner result normalized into the common schema. Candidate only. (DEMO)`,
      severity: "MEDIUM", confidence: 0.4,
      observedBehavior: `Matcher matched at ${matched.matched_at}`,
      remediation: "Triage per playbook",
      evidenceRefs: [{ evidenceId: evidence.id, role: "primary" }],
      actorId: "usr_researcher", sourceDetector: "nuclei-mock",
    });
  }

  // --- AI hypothesis + proposed test --------------------------------------
  const existingHypo = await db.hypothesis.findFirst({ where: { programId: program.id } });
  if (!existingHypo) {    const hypo = await db.hypothesis.create({
      data: {
        id: "hyp_demo_bola", orgId: acme.id, programId: program.id, origin: "AI",
        category: "BOLA",
        summary: "GET /v1/orders/{id} may lack tenant-ownership checks for support-agent identities (DEMO)",
        assumptionsJson: JSON.stringify(["Order objects carry a tenant field not checked against the caller", "Provisioned identity idt_support belongs to tenant-a"]),
        evidenceRefsJson: JSON.stringify([]),
        risk: "Cross-tenant disclosure of customer orders",
        proposedValidation: "Differential check idt_support vs idt_billing on fixture ord_1001 using the approved access matrix",
        requiredApprovalsJson: JSON.stringify(["test:propose", "test:approve"]),
        expectedOutcome: "Expected DENY for support agent; observed 2xx supports the hypothesis",
        alternativeExplanationsJson: JSON.stringify(["Fixture provisioning granted legitimate access"]),
        confidence: 0.55, limitations: "Mock provider output (DEMO)", status: "PROPOSED", modelVersion: "mock-provider-1",
      },
    });
    await db.test.create({
      data: {
        id: "tst_demo_bola", hypothesisId: hypo.id, orgId: acme.id, programId: program.id,
        oracleId: "differential-auth-matrix", policyVersionId: scope.id,
        planJson: JSON.stringify({ oracle_id: "differential-auth-matrix", target_host: "api.demo-target.test", target_path: "/v1/orders/ord_1001", method: "GET", identities: ["idt_support", "idt_billing"], notes: "DEMO plan" }),
        status: "PROPOSED", proposedBy: "usr_researcher",
      },
    });
    await addEdge({
      orgId: acme.id, sourceType: "Hypothesis", sourceId: hypo.id, relation: "SUPPORTS",
      targetType: "Endpoint", targetId: "ep_orders", confidence: 0.55, policyContext: "ai-proposal",
    });
  }

  await audit({
    orgId: acme.id, actorType: "SYSTEM", actorId: "seed", action: "system.seeded",
    resourceType: "System", resourceId: "seed", decision: "N/A",
    reason: "Demo dataset created (synthetic data only)",
  });

  // --- Workflow-invariant resource (FR-DET-03 demo) ------------------------
  const existingResource = await db.resource.findFirst({ where: { programId: program.id } });
  if (!existingResource) {
    await db.resource.create({
      data: {
        id: "res_order_workflow", programId: program.id,
        objectType: "order_workflow", fixtureRef: "fixture://disposable/orders-demo",
        invariantJson: JSON.stringify({
          initialState: "CART",
          terminalStates: ["FULFILLED", "CANCELLED"],
          transitions: [
            { from: "CART", to: "CHECKOUT" },
            { from: "CHECKOUT", to: "PAID", guard: "payment-confirmed" },
            { from: "PAID", to: "FULFILLED" },
            { from: "CART", to: "CANCELLED" },
            { from: "CHECKOUT", to: "CANCELLED" },
          ],
          idempotentOperations: ["submitPayment"],
          // Seeded recorded fixture run with TWO violations:
          //  - CHECKOUT→FULFILLED skips the PAID state (illegal transition)
          //  - submitPayment marked idempotent but replay outcome differs
          recorded: [
            { operation: "beginCheckout", from: "CART", to: "CHECKOUT" },
            { operation: "submitPayment", from: "CHECKOUT", to: "PAID", firstOutcome: "txn_001", replayOutcome: "txn_002" },
            { operation: "forceFulfill", from: "CHECKOUT", to: "FULFILLED" },
          ],
        }),
      },
    });
  }

  // --- Sample external SAST/SCA findings (correlation demo) -----------------
  const existingExternal = await db.externalFinding.findFirst({ where: { programId: program.id } });
  if (!existingExternal) {
    const { evidence: sastEvidence } = await storeEvidence({
      orgId: acme.id, createdBy: "usr_lead", source: "sast:import",
      content: { tool: "sast", rule: "sql-injection-spring", locator: "src/…/OrderRepository.java:88", cwe: "CWE-89", description: "Concatenated SQL in order lookup (DEMO)" },
    });
    await db.externalFinding.create({
      data: {
        id: "exf_sast_1", orgId: acme.id, programId: program.id, assetId: "ast_api",
        tool: "sast", rule: "sql-injection-spring", locator: "src/…/OrderRepository.java:88",
        cwe: "CWE-89", severity: "HIGH", description: "Concatenated SQL in order lookup (DEMO)",
        evidenceId: sastEvidence.id, correlationStatus: "UNCORRELATED",
      },
    });
  }

  // --- Sample webhook endpoint (recorded transport — no real egress) --------
  const existingWebhook = await db.webhookEndpoint.findFirst({ where: { orgId: acme.id } });
  if (!existingWebhook) {
    const { sealJson } = await import("../src/lib/crypto");
    await db.webhookEndpoint.create({
      data: {
        id: "whk_demo", orgId: acme.id, url: "https://hooks.example.test/scopegraph",
        secret: sealJson("demo-signing-secret-not-real"), eventsJson: JSON.stringify(["finding.status_changed", "policy.revoked"]),
        active: true,
      },
    });
  }

  // --- Initial asset snapshots (so change detection has a baseline) --------
  for (const a of assets) {
    const existingSnapshot = await db.assetSnapshot.findFirst({ where: { assetId: a.id } });
    if (!existingSnapshot) {
      const eps = await db.endpoint.findMany({
        where: { assetId: a.id },
        select: { method: true, routeTemplate: true },
        orderBy: [{ routeTemplate: "asc" }, { method: "asc" }],
      });
      await db.assetSnapshot.create({
        data: {
          id: newId("asn"), assetId: a.id,
          fingerprint: "seed", // placeholder replaced below by real fingerprint
          contentJson: JSON.stringify({
            endpoints: eps.map((e) => ({ method: e.method, routeTemplate: e.routeTemplate })),
            attributes: { scopeState: a.state, confidence: a.conf },
          }),
        },
      });
    }
  }
  // fix placeholder fingerprints using the real hash function
  {
    const { createHash } = await import("crypto");
    const snaps = await db.assetSnapshot.findMany({ where: { fingerprint: "seed" } });
    for (const s of snaps) {
      const fp = createHash("sha256").update(s.contentJson).digest("hex");
      await db.assetSnapshot.update({ where: { id: s.id }, data: { fingerprint: fp } });
    }
  }

  console.log("Seed complete.");
  console.log("Demo logins (password: Demo1234!): researcher@demo.test, lead@demo.test, owner@demo.test, validator@demo.test, admin@demo.test, auditor@demo.test, globex@demo.test");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
