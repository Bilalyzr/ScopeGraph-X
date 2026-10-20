import { db } from "@/lib/db";
import { sealJson, unsealJson } from "@/lib/crypto";
import { generateTotpSecret, otpauthUri, verifyTotp } from "./totp";

// MFA (TOTP) account security. Secrets are stored AES-256-GCM encrypted;
// enrollment requires a valid code before the factor is enabled.

export async function startEnrollment(userId: string, email: string) {
  const { secretBase32 } = generateTotpSecret();
  await db.userMfa.upsert({
    where: { userId },
    update: { secretEnc: sealJson(secretBase32), enabled: false, verifiedAt: null },
    create: { userId, secretEnc: sealJson(secretBase32), enabled: false },
  });
  return { secret: secretBase32, otpauth_uri: otpauthUri(secretBase32, email) };
}

export async function confirmEnrollment(userId: string, code: string): Promise<boolean> {
  const mfa = await db.userMfa.findUnique({ where: { userId } });
  if (!mfa) throw new Error("NO_ENROLLMENT");
  const secret = unsealJson<string>(mfa.secretEnc);
  if (!verifyTotp(secret, code)) return false;
  await db.userMfa.update({ where: { userId }, data: { enabled: true, verifiedAt: new Date() } });
  return true;
}

export async function isMfaEnabled(userId: string): Promise<boolean> {
  const mfa = await db.userMfa.findUnique({ where: { userId } });
  return mfa?.enabled ?? false;
}

/** Login-time MFA challenge: verify code against the enabled factor. */
export async function verifyLoginMfa(userId: string, code: string): Promise<boolean> {
  const mfa = await db.userMfa.findUnique({ where: { userId } });
  if (!mfa?.enabled) return true; // no factor enabled — password-only path
  const secret = unsealJson<string>(mfa.secretEnc);
  return verifyTotp(secret, code);
}

export async function disableMfa(userId: string): Promise<void> {
  await db.userMfa.deleteMany({ where: { userId } });
}
