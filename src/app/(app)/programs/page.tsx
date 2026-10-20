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
      <h1 style={{ fontSize: "1.2rem" }}>Programs & scope management</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Programs record the authorization source. No active testing may begin until a policy version is approved, activated and verified.
      </p>

      {canWrite && <CreateProgramForm />}

      <div className="card">
        <h2>Programs ({programs.length})</h2>
        {programs.length === 0 ? (
          <p className="empty">No programs yet — create one above.</p>
        ) : (
          <table className="data">
            <thead>
              <tr><th>Name</th><th>Provider / handle</th><th>State</th><th>Active policy</th><th>Authorization ref</th></tr>
            </thead>
            <tbody>
              {programs.map((p) => {
                const active = versions.find((v) => v.programId === p.id && v.status === "ACTIVE");
                return (
                  <tr key={p.id}>
                    <td><Link href={`/programs/${p.id}`}><strong>{p.name}</strong></Link></td>
                    <td className="mono">{p.provider}/{p.handle}</td>
                    <td><span className={`badge ${p.state === "ACTIVE" ? "ok" : "neutral"}`}>{p.state}</span></td>
                    <td>{active ? <span className="badge accent">v{active.version}</span> : <span className="badge warn">none</span>}</td>
                    <td className="mono" style={{ fontSize: "0.75rem" }}>{p.authorizationRef}</td>
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
