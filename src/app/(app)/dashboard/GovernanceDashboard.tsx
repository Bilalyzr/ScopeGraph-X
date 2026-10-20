import Link from "next/link";
import { db } from "@/lib/db";
import { verifyAuditChain } from "@/lib/audit";
import { ticketingMode } from "@/lib/ticketing";

// ADMIN CONSOLE — the governance-family dashboard (TENANT_ADMIN,
// PLATFORM_OPERATOR, PROGRAM_OWNER, AUDITOR). Everything here answers one
// question: "what needs my decision, and is the platform healthy?"

export async function GovernanceDashboard({ orgId, orgName, role }: { orgId: string; orgName: string; role: string }) {
  const [proposedPolicies, programs, awaitingAuthAssets, reportedFindings, unvalidatedFindings, members, evidenceExpiring, webhooks, tickets, stops, chain, recentAudit] =
    await Promise.all([
      db.scopeVersion.findMany({ where: { status: "PROPOSED", program: { orgId } }, include: { program: true }, orderBy: { createdAt: "asc" } }),
      db.program.findMany({ where: { orgId }, select: { id: true, name: true, state: true } }),
      db.asset.findMany({ where: { orgId, scopeState: "OWNERSHIP_VERIFIED" }, orderBy: { lastSeenAt: "desc" }, take: 8 }),
      db.finding.findMany({ where: { orgId, status: "REPORTED" }, orderBy: { updatedAt: "desc" }, take: 8 }),
      db.finding.count({ where: { orgId, status: { in: ["OBSERVED", "REPRODUCED"] }, validationStatus: "UNVALIDATED" } }),
      db.membership.count({ where: { orgId, state: "ACTIVE" } }),
      db.evidence.count({ where: { orgId, expiresAt: { lt: new Date(Date.now() + 7 * 86400_000) } } }),
      db.webhookEndpoint.findMany({ where: { orgId } }),
      db.ticketLink.count({ where: { orgId } }),
      db.emergencyStop.findFirst({ where: { active: true, OR: [{ scope: "GLOBAL" }, { orgId }] } }),
      verifyAuditChain(2000),
      db.auditEvent.findMany({ where: { orgId }, orderBy: { timestamp: "desc" }, take: 6 }),
    ]);

  const approvalsCount = proposedPolicies.length + awaitingAuthAssets.length + reportedFindings.length;

  return (
    <div className="dx">
      {/* ------------------------------------------------------------- hero */}
      <section className="dx-section" aria-labelledby="gx-h0">
        <header className="dx-head">
          <p className="dx-kicker"><span>00</span> Admin console</p>
          <h1 id="gx-h0" className="dx-h2" style={{ fontSize: "1.9rem" }}>
            {orgName} — governance &amp; control
          </h1>
          <p className="muted" style={{ margin: "0.4rem 0 0" }}>
            Signed in as <strong>{role}</strong>. This console is decision-first: approvals that wait on you,
            platform health, and the audit ledger. Hunting happens in the Finder Workbench.
          </p>
        </header>
        <div className="dx-plates">
          <Link href="/programs" className={`dx-plate ${approvalsCount > 0 ? "alert" : ""}`}>
            <span className="dx-plate-label">Awaiting decisions</span>
            <span className="dx-plate-n">{approvalsCount}</span>
            <span className="dx-plate-sub">{proposedPolicies.length} policies · {awaitingAuthAssets.length} assets · {reportedFindings.length} findings</span>
          </Link>
          <Link href="/findings" className="dx-plate">
            <span className="dx-plate-label">Unvalidated findings</span>
            <span className="dx-plate-n">{unvalidatedFindings}</span>
            <span className="dx-plate-sub">need an independent validator</span>
          </Link>
          <Link href="/admin" className="dx-plate">
            <span className="dx-plate-label">Members</span>
            <span className="dx-plate-n">{members}</span>
            <span className="dx-plate-sub">active operators in this org</span>
          </Link>
          <Link href="/admin" className={`dx-plate ${evidenceExpiring > 0 ? "alert" : ""}`}>
            <span className="dx-plate-label">Evidence expiring</span>
            <span className="dx-plate-n">{evidenceExpiring}</span>
            <span className="dx-plate-sub">within 7 days (retention)</span>
          </Link>
          <Link href="/audit" className={`dx-plate ${chain.ok ? "" : "alert"}`}>
            <span className="dx-plate-label">Audit chain</span>
            <span className="dx-plate-n" style={{ fontSize: "1.15rem" }}>{chain.ok ? "VERIFIED" : "BROKEN"}</span>
            <span className="dx-plate-sub">tamper-evident digests</span>
          </Link>
          <div className={`dx-plate ${stops ? "alert" : ""}`}>
            <span className="dx-plate-label">Emergency stop</span>
            <span className="dx-plate-n" style={{ fontSize: "1.15rem" }}>{stops ? "ENGAGED" : "CLEAR"}</span>
            <span className="dx-plate-sub">{stops ? "all active ops blocked" : "dispatch permitted under policy"}</span>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- 01 approvals */}
      <section className="dx-section" aria-labelledby="gx-h1">
        <header className="dx-head">
          <p className="dx-kicker"><span>01</span> Approval queues</p>
          <h2 id="gx-h1" className="dx-h2">What waits on your signature.</h2>
        </header>
        <div className="dx-split2">
          <article className="dx-card">
            <div>
              <div className="dx-card-head">
                <h3>Scope policies awaiting approval</h3>
                <Link href="/programs" className="dx-link">Programs →</Link>
              </div>
              {proposedPolicies.length === 0 ? (
                <p className="dx-empty">No proposed policy versions. New proposals appear here for approve → activate.</p>
              ) : (
                <ul className="dx-kv">
                  {proposedPolicies.map((v) => (
                    <li key={v.id}>
                      <span className="dot busy" />
                      <span className="k">{v.program?.name ?? v.programId} · v{v.version}</span>
                      <span className="v faint">proposed {v.createdAt.toISOString().slice(0, 10)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="dx-card-head" style={{ marginTop: "1rem" }}>
                <h3>Assets awaiting authorization</h3>
                <Link href="/assets?scope_state=OWNERSHIP_VERIFIED" className="dx-link">Queue →</Link>
              </div>
              {awaitingAuthAssets.length === 0 ? (
                <p className="dx-empty">No ownership-verified assets pending an authorization decision.</p>
              ) : (
                <ul className="dx-kv">
                  {awaitingAuthAssets.map((a) => (
                    <li key={a.id}>
                      <span className="dot ok" />
                      <span className="k mono">{a.canonicalLocator}</span>
                      <span className="v faint">verified, needs explicit AUTHORIZED</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </article>

          <article className="dx-card">
            <div>
              <div className="dx-card-head">
                <h3>Findings awaiting acceptance</h3>
                <Link href="/findings?status=REPORTED" className="dx-link">Reported →</Link>
              </div>
              {reportedFindings.length === 0 ? (
                <p className="dx-empty">Nothing reported. Validator-gated pipeline is quiet.</p>
              ) : (
                <ul className="dx-kv">
                  {reportedFindings.map((f) => (
                    <li key={f.id}>
                      <span className={`dot ${f.severity === "CRITICAL" || f.severity === "HIGH" ? "bad" : "busy"}`} />
                      <span className="k"><Link href={`/findings/${f.id}`}>{f.title.slice(0, 48)}</Link></span>
                      <span className="v">{f.severity}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </article>
        </div>
      </section>

      {/* ------------------------------------------------------------- 02 health */}
      <section className="dx-section" aria-labelledby="gx-h2">
        <header className="dx-head">
          <p className="dx-kicker"><span>02</span> Platform health</p>
          <h2 id="gx-h2" className="dx-h2">Integrations and posture.</h2>
        </header>
        <div className="dx-split2 wide-left">
          <div>
            <div className="terminal-panel">
              <div className="terminal-header">
                <span className="terminal-dots" aria-hidden="true">
                  <span className="terminal-dot coral" />
                  <span className="terminal-dot amber" />
                  <span className="terminal-dot mint" />
                </span>
                <span className="terminal-title">admin.console // status</span>
              </div>
              <div style={{ fontSize: "0.74rem", lineHeight: 1.65 }}>
                <div><span style={{ color: "var(--mint)" }}>[PROGRAMS]</span> {programs.length} total · {programs.filter((p) => p.state === "ACTIVE").length} active</div>
                <div><span style={{ color: chain.ok ? "var(--mint)" : "var(--coral)" }}>[AUDIT_CHAIN]</span> {chain.ok ? "digest chain verified" : `BROKEN at ${chain.brokenAt}`}</div>
                <div><span style={{ color: "var(--amber, #d9a441)" }}>[WEBHOOKS]</span> {webhooks.filter((w) => w.active).length}/{webhooks.length} active endpoints</div>
                <div><span style={{ color: "var(--amber, #d9a441)" }}>[TICKETING]</span> mode={ticketingMode()} · {tickets} linked ticket(s)</div>
                <div><span style={{ color: stops ? "var(--coral)" : "var(--mint)" }}>[E_STOP]</span> {stops ? "ENGAGED — dispatch blocked" : "clear"}<span className="terminal-cursor" /></div>
              </div>
            </div>
            <div className="row" style={{ marginTop: "0.9rem", flexWrap: "wrap" }}>
              <Link href="/admin" className="btn small">Administration</Link>
              <Link href="/audit" className="btn small">Audit ledger &amp; export</Link>
              <Link href="/settings" className="btn small">Account &amp; security</Link>
            </div>
          </div>

          <div>
            <div className="dx-card-head plain">
              <h3>Recent governance events</h3>
              <Link href="/audit" className="dx-link">Full ledger →</Link>
            </div>
            {recentAudit.length === 0 ? (
              <p className="dx-empty">The ledger is empty.</p>
            ) : (
              <ul className="dx-kv">
                {recentAudit.map((e) => (
                  <li key={e.id}>
                    <span className={`dot ${e.decision === "DENY" ? "bad" : e.decision === "ALLOW" ? "ok" : "busy"}`} />
                    <span className="k mono">{e.action}</span>
                    <span className="v faint mono">{e.timestamp.toISOString().slice(5, 16).replace("T", " ")}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
