import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { currentPrincipal } from "@/lib/auth/session";
import { CreateOrgForm } from "./CreateOrgForm";
import { PickOrgForm } from "./PickOrgForm";

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
      <div className="login-card" style={{ width: "min(560px, 94vw)" }}>
        <div className="brand" style={{ paddingBottom: "0.6rem" }}>
          <span className="brand-mark">SX</span>
          <span style={{ fontSize: "1.1rem" }}>ScopeGraph X — onboarding</span>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          Signed in as <strong>{principal.email}</strong>. {orgs.length > 0
            ? "Pick one of your organizations to continue, or create a new one."
            : "You are not a member of any organization yet — create one to start working. You will become its tenant administrator."}
        </p>
        {orgs.length > 0 && <PickOrgForm orgs={orgs} />}
        <div style={{ borderTop: orgs.length ? "1px solid var(--border)" : "none", marginTop: orgs.length ? "1rem" : 0, paddingTop: orgs.length ? "1rem" : 0 }}>
          <CreateOrgForm hasOrgs={orgs.length > 0} />
        </div>
      </div>
    </div>
  );
}
