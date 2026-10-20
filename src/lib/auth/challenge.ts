import { createHash, randomBytes } from "crypto";
import { db } from "@/lib/db";

// Short-lived MFA login challenges (5 minutes, single use).
const TTL_MS = 5 * 60_000;

export async function createMfaChallenge(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await db.mfaChallenge.create({
    data: {
      id: `mfc_${createHash("sha256").update(token).digest("hex")}`,
      userId,
      expiresAt: new Date(Date.now() + TTL_MS),
    },
  });
  return token;
}

export async function consumeMfaChallenge(token: string): Promise<string | null> {
  const id = `mfc_${createHash("sha256").update(token).digest("hex")}`;
  const challenge = await db.mfaChallenge.findUnique({ where: { id } });
  if (!challenge || challenge.usedAt || challenge.expiresAt < new Date()) return null;
  await db.mfaChallenge.update({ where: { id }, data: { usedAt: new Date() } });
  return challenge.userId;
}
