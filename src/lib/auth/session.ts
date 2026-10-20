import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { newId } from "@/lib/ids";

export const SESSION_COOKIE = "sgx_session";
const TTL_HOURS = Number(process.env.SESSION_TTL_HOURS || 24);

export interface Principal {
  userId: string;
  email: string;
  name: string;
  orgId: string | null;
  role: string | null;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string, orgId: string | null): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const id = `ses_${hashToken(token)}`;
  const expiresAt = new Date(Date.now() + TTL_HOURS * 3600_000);
  await db.session.create({ data: { id, userId, orgId, expiresAt } });
  return token;
}

export async function resolveSession(token: string | undefined): Promise<Principal | null> {
  if (!token) return null;
  const id = `ses_${hashToken(token)}`;
  const session = await db.session.findUnique({ where: { id } });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  const user = await db.user.findUnique({ where: { id: session.userId } });
  if (!user) return null;
  let role: string | null = null;
  if (session.orgId) {
    const membership = await db.membership.findUnique({
      where: { orgId_principalId: { orgId: session.orgId, principalId: user.id } },
    });
    role = membership?.state === "ACTIVE" ? membership.role : null;
  }
  return { userId: user.id, email: user.email, name: user.name, orgId: session.orgId, role };
}

export async function currentPrincipal(): Promise<Principal | null> {
  const jar = await cookies();
  return resolveSession(jar.get(SESSION_COOKIE)?.value);
}

export async function revokeSession(token: string): Promise<void> {
  await db.session.update({
    where: { id: `ses_${hashToken(token)}` },
    data: { revokedAt: new Date() },
  });
}

export async function switchOrg(sessionToken: string, userId: string, orgId: string): Promise<void> {
  const membership = await db.membership.findUnique({
    where: { orgId_principalId: { orgId, principalId: userId } },
  });
  if (!membership || membership.state !== "ACTIVE") {
    throw new Error("NOT_A_MEMBER");
  }
  await db.session.update({ where: { id: `ses_${hashToken(sessionToken)}` }, data: { orgId } });
}

export { newId };
