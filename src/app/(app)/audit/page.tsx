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
        <h1>Audit log</h1>
        <div className="card">
          <p className="empty">
            Access denied — your role ({principal.role}) does not include <code className="inline">audit:read</code>.
          </p>
        </div>
      </div>
    );
  }
  const sp = await searchParams;
  const LIMIT = 40;
  const rows = await db.auditEvent.findMany({
    where: {
      OR: [{ orgId: principal.orgId }, ...(principal.role === "PLATFORM_OPERATOR" ? [{ orgId: "system" }] : [])],
      ...(sp.action ? { action: sp.action } : {}),
      ...(sp.cursor ? { id: { lt: sp.cursor } } : {}),
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
        <div>
          <div className="mono-label">APPEND-ONLY CRYPTOGRAPHIC LEDGER // SHA-256</div>
          <h1 style={{ margin: "0.15rem 0 0" }}>Audit log</h1>
        </div>
        <span className={`badge ${chain.ok ? "ok" : "danger"}`}>
          <span className="signal-dot" style={{ width: 6, height: 6 }} />{" "}
          {chain.ok ? "digest chain verified" : `CHAIN BROKEN at ${chain.brokenAt}`}
        </span>
      </div>
      <p className="muted" style={{ marginTop: "0.35rem" }}>
        Append-only, hash-chained records (actor · action · resource · decision · timestamp). Tampering with any historical row breaks every later digest.
      </p>

      <div className="row" style={{ marginBottom: "0.9rem" }}>
        <Link href="/audit" className={`badge ${!sp.action ? "accent" : "neutral"}`}>
          all
        </Link>
        {actions.map((a) => (
          <Link key={a} href={`/audit?action=${a}`} className={`badge ${sp.action === a ? "accent" : "neutral"}`}>
            {a}
          </Link>
        ))}
        <a href="/api/v1/audit-events/export" className="btn small" download>
          ⇩ Export CSV (audited)
        </a>
      </div>

      <div className="section-label">
        <span className="section-label-num">01</span>
        <span>HASH-CHAINED EVENT STREAM</span>
      </div>

      <div className="card">
        <table className="data">
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Resource</th>
              <th>Decision</th>
              <th>Reason / detail</th>
              <th>Digest</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td className="faint" style={{ fontSize: "0.72rem", whiteSpace: "nowrap" }}>
                  {e.timestamp.toISOString().slice(0, 19).replace("T", " ")}
                </td>
                <td className="mono" style={{ fontSize: "0.72rem" }}>
                  {e.actorId}
                  <div className="faint">{e.actorType}</div>
                </td>
                <td className="mono" style={{ fontSize: "0.75rem" }}>
                  {e.action}
                </td>
                <td className="mono" style={{ fontSize: "0.72rem" }}>
                  {e.resourceType}
                  <div className="faint">{e.resourceId.slice(0, 20)}</div>
                </td>
                <td>
                  <span className={`badge ${e.decision === "DENY" ? "danger" : e.decision === "ALLOW" ? "ok" : "neutral"}`}>
                    {e.decision}
                  </span>
                </td>
                <td style={{ fontSize: "0.78rem" }}>{e.reason || "—"}</td>
                <td className="mono faint" style={{ fontSize: "0.65rem", whiteSpace: "nowrap" }}>
                  <span title={`prev: ${e.prevDigest}`}>{e.prevDigest.slice(0, 6)}</span>
                  <span style={{ color: "var(--coral)", margin: "0 3px" }}>→</span>
                  <strong style={{ color: "var(--ink)" }} title={`digest: ${e.digest}`}>{e.digest.slice(0, 8)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {hasMore && events.length > 0 && (
          <div className="row spread" style={{ marginTop: "0.85rem" }}>
            <span className="hint" style={{ margin: 0 }}>
              Showing {events.length} events in hash-chain order.
            </span>
            <Link
              href={`/audit?cursor=${events[events.length - 1].id}${sp.action ? `&action=${sp.action}` : ""}`}
              className="btn small"
            >
              LOAD OLDER EVENTS →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
