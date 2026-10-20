import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { currentPrincipal } from "@/lib/auth/session";
import { OrgSwitcher } from "@/components/OrgSwitcher";
import { EmergencyStopButton } from "@/components/EmergencyStopButton";
import LogoutButton from "@/components/LogoutButton";
import { ThemeToggle } from "@/components/ThemeToggle";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const principal = await currentPrincipal();
  if (!principal) redirect("/login");

  const memberships = await db.membership.findMany({ where: { principalId: principal.userId, state: "ACTIVE" } });
  const orgs = await Promise.all(
    memberships.map(async (m) => {
      const org = await db.organization.findUnique({ where: { id: m.orgId } });
      return { id: m.orgId, name: org?.name ?? m.orgId, role: m.role };
    })
  );
  const activeOrg = orgs.find((o) => o.id === principal.orgId) ?? null;
  const stopActive = activeOrg
    ? (await db.emergencyStop.findFirst({
        where: { active: true, OR: [{ scope: "GLOBAL" }, { scope: "ORG", orgId: activeOrg.id }] },
      })) != null
    : false;

  const nav: Array<{ section: string; items: Array<{ href: string; label: string }> }> = [
    {
      section: "Overview",
      items: [
        { href: "/dashboard", label: "Dashboard" },
        { href: "/programs", label: "Programs & Scope" },
        { href: "/assets", label: "Asset Inventory" },
        { href: "/graph", label: "Knowledge Graph" },
      ],
    },
    {
      section: "Research",
      items: [
        { href: "/campaigns", label: "Campaigns" },
        { href: "/research", label: "Hypotheses & Tests" },
        { href: "/findings", label: "Findings" },
        { href: "/reports", label: "Reports" },
      ],
    },
    {
      section: "Governance",
      items: [
        { href: "/audit", label: "Audit Log" },
        { href: "/admin", label: "Administration" },
        { href: "/settings", label: "Account & Security" },
      ],
    },
  ];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">SX</span>
          <span>ScopeGraph X</span>
        </div>
        {stopActive && (
          <div className="msg error" style={{ fontSize: "0.72rem", padding: "0.4rem 0.6rem", margin: "0 0 0.6rem" }}>
            ⛔ Emergency stop ACTIVE — all active operations blocked
          </div>
        )}
        <nav className="nav" aria-label="Main">
          {nav.map((group) => (
            <div key={group.section}>
              <div className="nav-section">{group.section}</div>
              {group.items.map((item) => (
                <Link key={item.href} href={item.href}>
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div style={{ marginTop: "1.4rem", borderTop: "1px solid var(--border)", paddingTop: "0.8rem", fontSize: "0.75rem", color: "var(--text-faint)" }}>
          EGRESS MODE: <strong style={{ color: "var(--warn)" }}>simulated</strong>
          <div style={{ marginTop: 2 }}>No real network traffic is sent to targets.</div>
        </div>
      </aside>
      <main className="main" id="main">
        <a href="#main" className="skip-link">Skip to main content</a>
        <div className="topbar">
          <div className="row">
            <strong>{activeOrg?.name ?? "No organization selected"}</strong>
            {activeOrg && <span className="badge neutral">{activeOrg.role}</span>}
          </div>
          <div className="row">
            <OrgSwitcher orgs={orgs} activeOrgId={principal.orgId} />
            <span className="faint" style={{ fontSize: "0.8rem" }}>{principal.email}</span>
            <EmergencyStopButton active={stopActive} />
            <ThemeToggle />
            <LogoutButton />
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
