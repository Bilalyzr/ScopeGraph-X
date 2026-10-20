import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { currentPrincipal } from "@/lib/auth/session";
import { roleHas } from "@/lib/rbac";
import { verifyAuditChain } from "@/lib/audit";
import { ApiAction } from "@/components/ApiAction";
import { WebhooksPanel } from "./WebhooksPanel";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const principal = await currentPrincipal();
  if (!principal?.orgId) redirect("/login");
  const isAdmin = roleHas(principal.role!, "org:admin");
  if (!isAdmin) {
    return (
      <div>
        <h1 style={{ fontSize: "1.2rem" }}>Administration</h1>
        <div className="card"><p className="empty">Access denied — requires TENANT_ADMIN or PLATFORM_OPERATOR.</p></div>
      </div>
    );
  }

  const org = await db.organization.findUnique({ where: { id: principal.orgId } });
  const members = await db.membership.findMany({ where: { orgId: principal.orgId } });
  const users = await Promise.all(members.map(async (m) => ({ ...m, user: await db.user.findUnique({ where: { id: m.principalId } }) })));
  const stops = await db.emergencyStop.findMany({ where: { OR: [{ orgId: principal.orgId }, { scope: "GLOBAL" }] }, orderBy: { createdAt: "desc" } });
  const chain = await verifyAuditChain(5000);
  const evidenceCount = await db.evidence.count({ where: { orgId: principal.orgId } });
  const expiring = await db.evidence.count({
    where: { orgId: principal.orgId, expiresAt: { lt: new Date(Date.now() + 7 * 86400_000) } },
  });

  return (
    <div>
      <h1 style={{ fontSize: "1.2rem" }}>Administration</h1>

      <div className="grid metrics">
        <div className="metric"><div className="label">Organization</div><div className="value" style={{ fontSize: "1.05rem" }}>{org?.name}</div><div className="sub">{org?.slug} · {org?.region} · {org?.status}</div></div>
        <div className="metric"><div className="label">Members</div><div className="value">{members.length}</div></div>
        <div className="metric"><div className="label">Evidence objects</div><div className="value">{evidenceCount}</div><div className="sub">{expiring} expiring within 7d</div></div>
        <div className="metric"><div className="label">Audit chain</div><div className="value" style={{ fontSize: "1.05rem" }}>{chain.ok ? "VERIFIED" : "BROKEN"}</div><div className="sub">tamper-evident digests</div></div>
      </div>

      <div className="card">
        <h2>Members & roles</h2>
        <table className="data">
          <thead><tr><th>User</th><th>Email</th><th>Role</th><th>State</th></tr></thead>
          <tbody>
            {users.map((m) => (
              <tr key={m.id}>
                <td>{m.user?.name ?? m.principalId}</td>
                <td className="mono" style={{ fontSize: "0.78rem" }}>{m.user?.email}</td>
                <td><span className="badge accent">{m.role}</span></td>
                <td>{m.state}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Emergency stops</h2>
        {stops.length === 0 ? (
          <p className="empty">No emergency stops recorded. The control is in the top bar on every screen.</p>
        ) : (
          <table className="data">
            <thead><tr><th>Scope</th><th>Reason</th><th>State</th><th>Created</th><th></th></tr></thead>
            <tbody>
              {stops.map((s) => (
                <tr key={s.id}>
                  <td><span className="badge danger">{s.scope}</span></td>
                  <td style={{ fontSize: "0.82rem" }}>{s.reason}</td>
                  <td><span className={`badge ${s.active ? "danger" : "neutral"}`}>{s.active ? "ACTIVE" : "lifted"}</span></td>
                  <td className="faint" style={{ fontSize: "0.72rem" }}>{s.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                  <td>
                    {s.active && (
                      <ApiAction label="Lift stop" method="DELETE" url={`/api/v1/emergency-stop?id=${s.id}`} className="btn small" confirmText="Lift this emergency stop and re-permit policy-gated operations?" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <WebhooksPanel />

      <div className="card">
        <h2>Deployment posture (honest status)</h2>
        <dl className="kv">
          <dt>Egress mode</dt><dd><span className="badge warn">SIMULATED</span> — no real network traffic to targets exists in this build</dd>
          <dt>Database</dt><dd>SQLite (dev). Production target: PostgreSQL via <code className="inline">DATABASE_URL</code> + docker-compose</dd>
          <dt>Graph store</dt><dd>SQL projection (<code className="inline">graph_edges</code>) behind a replaceable adapter — Neo4j not required</dd>
          <dt>AI provider</dt><dd>mock-provider-1 — deterministic, no external API, no key</dd>
          <dt>Scanner adapters</dt><dd>Mock Nuclei-format importer; real ZAP/Nuclei integrations are adapter interfaces only</dd>
          <dt>SSO / MFA</dt><dd>Not integrated yet — session auth is local; OIDC/SAML is a documented integration point</dd>
          <dt>Workers</dt><dd>In-process durable queue; isolated worker pools are production design, not claimed here</dd>
        </dl>
      </div>
    </div>
  );
}
