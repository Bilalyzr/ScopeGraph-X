import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { currentPrincipal } from "@/lib/auth/session";
import { OrgSwitcher } from "@/components/OrgSwitcher";
import { EmergencyStopButton } from "@/components/EmergencyStopButton";
import LogoutButton from "@/components/LogoutButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BranchedNav, type NavGroup } from "@/components/BranchedNav";
import { SidebarCollapseButton } from "@/components/SidebarCollapseButton";

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

  const nav: NavGroup[] = [
    {
      code: "01",
      section: "Overview",
      items: [
        { href: "/dashboard", label: "Dashboard", code: "SYS" },
        { href: "/programs", label: "Programs & Scope", code: "PRM" },
        { href: "/assets", label: "Asset Inventory", code: "AST" },
        { href: "/graph", label: "Knowledge Graph", code: "KGR" },
      ],
    },
    {
      code: "02",
      section: "Research",
      items: [
        { href: "/campaigns", label: "Campaigns", code: "CMP" },
        { href: "/research", label: "Hypotheses & Tests", code: "HYP" },
        { href: "/findings", label: "Findings", code: "FND" },
        { href: "/reports", label: "Reports", code: "RPT" },
      ],
    },
    {
      code: "03",
      section: "Governance",
      items: [
        { href: "/audit", label: "Audit Log", code: "AUD" },
        { href: "/admin", label: "Administration", code: "ADM" },
        { href: "/settings", label: "Account & Security", code: "SEC" },
      ],
    },
  ];

  const tickerItems = [
    `TENANT: ${(activeOrg?.name ?? "UNSELECTED").toUpperCase()}`,
    `ROLE: ${activeOrg?.role ?? "NONE"}`,
    `GATEWAY POSTURE: ${stopActive ? "EMERGENCY HALT" : "DEFAULT-DENY ENFORCING"}`,
    "EGRESS TRANSPORT: SIMULATED SANDBOX",
    "AUDIT LEDGER: SHA-256 HASH-CHAINED",
    "SEGREGATION OF DUTIES: ACTIVE",
  ];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">SX</span>
          <div className="brand-title">
            <span className="brand-name">ScopeGraph X</span>
            <span className="brand-sub">Signal Press · v2.4</span>
          </div>
          <SidebarCollapseButton variant="sidebar" />
        </div>

        {/* Signature Component: Pulse Motif (ECG Heartbeat) */}
        <div className="pulse-strip" aria-label="Instrument heartbeat">
          <span className="pulse-strip-label">
            <span
              className="signal-dot"
              style={stopActive ? { background: "var(--coral)", boxShadow: "0 0 0 3px rgba(252,103,86,.28)" } : undefined}
            />
            {stopActive ? "HALTED" : "LIVE GATEWAY"}
          </span>
          <svg className="ecg-svg" width="88" height="22" viewBox="0 0 88 22" aria-hidden="true">
            <polyline
              className="ecg-line"
              style={stopActive ? { stroke: "var(--coral)" } : undefined}
              points="0,12 18,12 24,12 28,4 33,19 38,2 43,16 47,10 52,12 88,12"
            />
          </svg>
        </div>

        {stopActive && (
          <div className="msg error" style={{ fontSize: "0.7rem", padding: "0.5rem 0.7rem", margin: "0 0 0.75rem" }}>
            ⛔ EMERGENCY STOP ACTIVE — ALL ACTIVE OPERATIONS BLOCKED
          </div>
        )}

        {/* Signature Component: Branched Navigation */}
        <BranchedNav groups={nav} />

        {/* Signature Component: Compact Terminal Panel in Sidebar Footer */}
        <div className="terminal-panel" style={{ marginTop: "auto", marginBottom: 0, padding: "0.75rem 0.9rem", boxShadow: "4px 4px 0 var(--coral)" }}>
          <div className="terminal-header" style={{ paddingBottom: "0.45rem", marginBottom: "0.45rem" }}>
            <span className="terminal-dots" aria-hidden="true">
              <span className="terminal-dot coral" />
              <span className="terminal-dot amber" />
              <span className="terminal-dot mint" />
            </span>
            <span className="terminal-title">egress.ctl</span>
          </div>
          <div style={{ fontSize: "0.68rem", lineHeight: 1.5 }}>
            <div>
              <span style={{ color: "var(--mint)" }}>$</span> mode:{" "}
              <strong style={{ color: "var(--coral)" }}>SIMULATED</strong>
            </div>
            <div style={{ color: "#9da69b" }}>
              Zero real packets leave host
              <span className="terminal-cursor" />
            </div>
          </div>
        </div>
      </aside>

      <div className="workspace-col">
        <a href="#main" className="skip-link">Skip to main content</a>

        <header className="topbar">
          <div className="topbar-meta">
            <SidebarCollapseButton variant="topbar" />
            <span className="topbar-org-label">WORKSPACE //</span>
            <strong style={{ color: "var(--ink)", fontSize: "0.95rem" }}>
              {activeOrg?.name ?? "No organization selected"}
            </strong>
            {activeOrg && <span className="badge accent">{activeOrg.role}</span>}
          </div>
          <div
            className="row"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--border-ink)",
              borderRadius: "999px",
              padding: "0.28rem 0.55rem",
              gap: "0.5rem",
            }}
          >
            <OrgSwitcher orgs={orgs} activeOrgId={principal.orgId} />
            <span className="badge neutral" title="Authenticated operator" style={{ background: "var(--surface)" }}>
              {principal.email}
            </span>
            <EmergencyStopButton active={stopActive} />
            <ThemeToggle />
            <LogoutButton />
          </div>
        </header>

        {/* Signature Component: Full-width Hairline-Bounded Marquee Strip */}
        <div className="marquee-strip" aria-label="Operational telemetry ticker">
          <div className="marquee-track">
            {[...tickerItems, ...tickerItems].map((item, idx) => (
              <span key={idx} className="marquee-item">
                <span>{item}</span>
                <span className="marquee-sep">✦</span>
              </span>
            ))}
          </div>
        </div>

        <main className="main" id="main">
          {children}
        </main>
      </div>
    </div>
  );
}
