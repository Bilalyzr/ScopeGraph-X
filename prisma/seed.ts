/**
 * Database bootstrap — initializes tenant organizations and operator principals
 * with a clean slate (no synthetic mock programs, assets, findings, or fixtures).
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password";
import { newId } from "../src/lib/ids";

const db = new PrismaClient();

const DEFAULT_PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? "Demo1234!";

async function main() {
  console.log("Initializing ScopeGraph X workspace (clean slate — no mock data) …");

  // Purge any previously seeded synthetic / mock domain records
  await db.findingEvidence.deleteMany({});
  await db.findingStatusEvent.deleteMany({});
  await db.finding.deleteMany({});
  await db.observation.deleteMany({});
  await db.test.deleteMany({});
  await db.hypothesis.deleteMany({});
  await db.externalFinding.deleteMany({});
  await db.resource.deleteMany({});
  await db.egressCheck.deleteMany({});
  await db.job.deleteMany({});
  await db.campaign.deleteMany({});
  await db.endpoint.deleteMany({});
  await db.assetObservation.deleteMany({});
  await db.assetSnapshot.deleteMany({});
  await db.assetChange.deleteMany({});
  await db.asset.deleteMany({});
  await db.scopeVersion.deleteMany({});
  await db.identity.deleteMany({});
  await db.program.deleteMany({});
  await db.webhookDelivery.deleteMany({});
  await db.webhookEndpoint.deleteMany({});
  await db.graphEdge.deleteMany({});
  await db.evidence.deleteMany({});
  await db.auditEvent.deleteMany({});

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

  // --- Users & memberships -----------------------------------------------
  const users = [
    { id: "usr_researcher", email: "researcher@demo.test", name: "Riley Researcher", memberships: [{ org: acme.id, role: "RESEARCHER" }] },
    { id: "usr_lead", email: "lead@demo.test", name: "Lena Lead", memberships: [{ org: acme.id, role: "APPSEC_LEAD" }] },
    { id: "usr_owner", email: "owner@demo.test", name: "Oscar Owner", memberships: [{ org: acme.id, role: "PROGRAM_OWNER" }] },
    { id: "usr_validator", email: "validator@demo.test", name: "Vera Validator", memberships: [{ org: acme.id, role: "VALIDATOR" }] },
    { id: "usr_admin", email: "admin@demo.test", name: "Ada Admin", memberships: [{ org: acme.id, role: "TENANT_ADMIN" }] },
    { id: "usr_auditor", email: "auditor@demo.test", name: "Arnold Auditor", memberships: [{ org: acme.id, role: "AUDITOR" }] },
    { id: "usr_globex", email: "globex@demo.test", name: "Greta Globex", memberships: [{ org: globex.id, role: "TENANT_ADMIN" }] },
  ];
  const passwordHash = hashPassword(DEFAULT_PASSWORD);
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

  console.log("Workspace initialized with 0 mock records.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
