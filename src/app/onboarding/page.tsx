import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { currentPrincipal } from "@/lib/auth/session";
import { CreateOrgForm } from "./CreateOrgForm";
import { OrgPicker } from "@/components/OrgPicker";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const principal = await currentPrincipal();
  if (!principal) redirect("/login");

  const memberships = await db.membership.findMany({ where: { principalId: principal.userId, state: "ACTIVE" } });
  const orgs = await Promise.all(
    memberships.map(async (m) => {
      const org = await db.organization.findUnique({ where: { id: m.orgId } });
      return { id: m.orgId, name: org?.name ?? m.orgId };
    })
  );

  return (
    <div className="login-wrap">
      <div className="login-card card" style={{ width: "min(600px, 94vw)", marginBottom: 0 }}>
        <div className="brand" style={{ paddingBottom: "0.75rem" }}>
          <span className="brand-mark">SX</span>
          <div className="brand-title">
            <span className="brand-name">ScopeGraph X — Onboarding</span>
            <span className="brand-sub">Tenant Workspace Provisioning</span>
          </div>
        </div>
        <div
          className="row"
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border-ink)",
            borderRadius: 12,
            padding: "0.55rem 0.85rem",
            marginBottom: "0.85rem",
            justifyContent: "space-between",
          }}
        >
          <span className="badge ok">01 AUTH VERIFIED ✓</span>
          <span className="mono faint">──▶</span>
          <span className="badge accent">02 PROVISION WORKSPACE</span>
          <span className="mono faint">──▶</span>
          <span className="badge neutral">03 DEFINE SCOPE</span>
        </div>
        <div className="section-label" style={{ marginTop: "0.5rem" }}>
          <span className="section-label-num">01</span>
          <span>TENANT SELECTION</span>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          Signed in as <strong>{principal.email}</strong>.{" "}
          {orgs.length > 0
            ? "Pick one of your organizations to continue, or create a new one."
            : "You are not a member of any organization yet — create one to start working. You will become its tenant administrator."}
        </p>
        {orgs.length > 0 && <OrgPicker orgs={orgs} activeOrgId={null} variant="buttons" label="Your organizations" />}
        <div
          style={{
            borderTop: orgs.length ? "1px solid var(--border-ink)" : "none",
            marginTop: orgs.length ? "1.2rem" : 0,
            paddingTop: orgs.length ? "1.2rem" : 0,
          }}
        >
          <CreateOrgForm hasOrgs={orgs.length > 0} />
        </div>
      </div>
    </div>
  );
}
