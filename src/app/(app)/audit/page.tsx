import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { currentPrincipal } from "@/lib/auth/session";
import { roleHas } from "@/lib/rbac";
import { verifyAuditChain } from "@/lib/audit";

export const dynamic = "force-dynamic";

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string; cursor?: string }> }) {
  const principal = await currentPrincipal();
  if (!principal?.orgId) redirect("/login");
  if (!roleHas(principal.role!, "audit:read")) {
    return (
      <div>
        <h1 style={{ fontSize: "1.2rem" }}>Audit log</h1>
        <div className="card"><p className="empty">Access denied — your role ({principal.role}) does not include <code className="inline">audit:read</code>.</p></div>
      </div>
    );
  }
  const sp = await searchParams;
  const LIMIT = 40;
  const rows = await db.auditEvent.findMany({
    where: {
      OR: [{ orgId: principal.orgId }, ...(principal.role === "PLATFORM_OPERATOR" ? [{ orgId: "system" }] : [])],
      ...(sp.action ? { action: sp.action } : {}),
    },
    orderBy: { id: "desc" },
    take: LIMIT + 1,
  });
  const hasMore = rows.length > LIMIT;
  const events = rows.slice(0, LIMIT);
  const chain = await verifyAuditChain(2000);
  const actions = [...new Set(events.map((e) => e.action))].slice(0, 8);

  return (
    <div>
      <div className="row spread">
        <h1 style={{ fontSize: "1.2rem", margin: 0 }}>Audit log</h1>
        <span className={`badge ${chain.ok ? "ok" : "danger"}`}>
          {chain.ok ? "digest chain verified" : `CHAIN BROKEN at ${chain.brokenAt}`}
        </span>
      </div>
      <p className="muted" style={{ marginTop: "0.4rem" }}>
        Append-only, hash-chained records (actor · action · resource · decision · timestamp). Tampering with any historical row breaks every later digest.
      </p>

      <div className="row" style={{ marginBottom: "0.8rem" }}>
        <Link href="/audit" className={`badge ${!sp.action ? "accent" : "neutral"}`}>all</Link>
        {actions.map((a) => (
          <Link key={a} href={`/audit?action=${a}`} className={`badge ${sp.action === a ? "accent" : "neutral"}`}>{a}</Link>
        ))}
        <a href="/api/v1/audit-events/export" className="btn small" download>⇩ Export CSV (audited)</a>
      </div>

      <div className="card">
        <table className="data">
          <thead>
            <tr><th>When</th><th>Actor</th><th>Action</th><th>Resource</th><th>Decision</th><th>Reason / detail</th><th>Digest</th></tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td className="faint" style={{ fontSize: "0.72rem", whiteSpace: "nowrap" }}>{e.timestamp.toISOString().slice(0, 19).replace("T", " ")}</td>
                <td className="mono" style={{ fontSize: "0.72rem" }}>{e.actorId}<div className="faint">{e.actorType}</div></td>
                <td className="mono" style={{ fontSize: "0.75rem" }}>{e.action}</td>
                <td className="mono" style={{ fontSize: "0.72rem" }}>{e.resourceType}<div className="faint">{e.resourceId.slice(0, 20)}</div></td>
                <td><span className={`badge ${e.decision === "DENY" ? "danger" : e.decision === "ALLOW" ? "ok" : "neutral"}`}>{e.decision}</span></td>
                <td style={{ fontSize: "0.78rem" }}>{e.reason || "—"}</td>
                <td className="mono faint" style={{ fontSize: "0.65rem" }}>{e.digest.slice(0, 10)}…</td>
              </tr>
            ))}
          </tbody>
        </table>
        {hasMore && <p className="hint">Older events exist — filter by action or use the API cursor (<code className="inline">GET /v1/audit-events</code>).</p>}
      </div>
    </div>
  );
}
