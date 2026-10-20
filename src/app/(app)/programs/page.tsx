import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { currentPrincipal } from "@/lib/auth/session";
import { roleHas } from "@/lib/rbac";
import { CreateProgramForm } from "./CreateProgramForm";

export const dynamic = "force-dynamic";

export default async function ProgramsPage() {
  const principal = await currentPrincipal();
  if (!principal?.orgId) redirect("/login");
  const programs = await db.program.findMany({
    where: { orgId: principal.orgId },
    orderBy: { createdAt: "desc" },
  });
  const versions = await db.scopeVersion.findMany({
    where: { program: { orgId: principal.orgId } },
    orderBy: { createdAt: "desc" },
  });
  const canWrite = roleHas(principal.role!, "program:write");

  return (
    <div>
      <div className="row spread" style={{ marginBottom: "0.4rem" }}>
        <div>
          <div className="mono-label">POLICY BOUNDARY // ENGAGEMENT LEDGER</div>
          <h1 style={{ margin: "0.15rem 0 0" }}>Programs &amp; scope management</h1>
        </div>
        <span className="badge accent">{programs.length} REGISTERED PROGRAMS</span>
      </div>
      <p className="muted" style={{ marginTop: "0.25rem" }}>
        Programs record the authorization source. No active testing may begin until a policy version is approved, activated and verified.
      </p>

      {canWrite && <CreateProgramForm />}

      <div className="section-label">
        <span className="section-label-num">01</span>
        <span>AUTHORIZED PROGRAM REGISTRY</span>
      </div>

      <div className="card">
        <h2>
          <span>Programs ({programs.length})</span>
          <span className="mono-label">SEGREGATION OF DUTIES ENFORCED</span>
        </h2>
        {programs.length === 0 ? (
          <p className="empty">No programs yet — create one above.</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Provider / handle</th>
                <th>State</th>
                <th>Active policy</th>
                <th>Authorization ref</th>
              </tr>
            </thead>
            <tbody>
              {programs.map((p) => {
                const active = versions.find((v) => v.programId === p.id && v.status === "ACTIVE");
                return (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/programs/${p.id}`}>
                        <strong>{p.name}</strong>
                      </Link>
                    </td>
                    <td className="mono">
                      {p.provider}/{p.handle}
                    </td>
                    <td>
                      <span className={`badge ${p.state === "ACTIVE" ? "ok" : "neutral"}`}>{p.state}</span>
                    </td>
                    <td>
                      {active ? (
                        <span className="badge ok">
                          <span className="signal-dot" style={{ width: 6, height: 6 }} /> v{active.version} ACTIVE
                        </span>
                      ) : (
                        <span className="badge warn">NO ACTIVE POLICY</span>
                      )}
                    </td>
                    <td className="mono" style={{ fontSize: "0.75rem" }}>
                      {p.authorizationRef}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
