/**
 * Key rotation (KMS parity): re-seal every encrypted artifact from the
 * PREVIOUS key to the CURRENT key.
 *
 * Usage — set the new key as EVIDENCE_ENCRYPTION_KEY and the old key as
 * EVIDENCE_ENCRYPTION_KEY_PREVIOUS, then run:
 *   npm run rotate-key
 * After it reports success and you have verified reads, remove the previous
 * key from the environment.
 */
import path from "path";
import * as fs from "fs/promises";
import { createHash } from "crypto";
import { db } from "../src/lib/db";
import { seal, unseal, unsealJson, sealJson, keyInfo } from "../src/lib/crypto";

const STORE_DIR = process.env.EVIDENCE_STORE_DIR || ".data/evidence";

interface Sealed { v: 1; iv: string; tag: string; ct: string }

async function reencryptEvidence(): Promise<{ rotated: number; skipped: number }> {
  let rotated = 0;
  let skipped = 0;
  for (const e of await db.evidence.findMany()) {
    const rel = e.encryptedObjectUri.replace("local://", "");
    const abs = path.join(process.cwd(), STORE_DIR, ...rel.split("/"));
    let raw: string;
    try {
      raw = await fs.readFile(abs, "utf8");
    } catch {
      skipped += 1;
      continue; // object missing from store
    }
    let plaintext: string;
    try {
      plaintext = unseal(JSON.parse(raw) as Sealed); // current-or-previous key
    } catch {
      skipped += 1;
      continue; // tampered or unknown key — leave for investigation
    }
    // integrity must hold before re-sealing
    if (createHash("sha256").update(plaintext).digest("hex") !== e.sha256) {
      skipped += 1;
      continue;
    }
    await fs.writeFile(abs, JSON.stringify(seal(plaintext)), "utf8"); // new key
    rotated += 1;
  }
  return { rotated, skipped };
}

async function reencryptWebhookSecrets(): Promise<number> {
  let rotated = 0;
  for (const ep of await db.webhookEndpoint.findMany()) {
    try {
      const secret = unsealJson<string>(ep.secret);
      await db.webhookEndpoint.update({ where: { id: ep.id }, data: { secret: sealJson(secret) } });
      rotated += 1;
    } catch {
      // unknown key — skip
    }
  }
  return rotated;
}

async function reencryptMfaSecrets(): Promise<number> {
  let rotated = 0;
  for (const mfa of await db.userMfa.findMany()) {
    try {
      const secret = unsealJson<string>(mfa.secretEnc);
      await db.userMfa.update({ where: { userId: mfa.userId }, data: { secretEnc: sealJson(secret) } });
      rotated += 1;
    } catch {
      // unknown key — skip
    }
  }
  return rotated;
}

async function main() {
  const info = keyInfo();
  if (info.isFallback) {
    console.error("[rotate-key] REFUSING: EVIDENCE_ENCRYPTION_KEY is not set (dev fallback in use).");
    process.exit(1);
  }
  if (!info.hasPrevious) {
    console.error("[rotate-key] REFUSING: EVIDENCE_ENCRYPTION_KEY_PREVIOUS is not set.");
    console.error("               Set the NEW key as EVIDENCE_ENCRYPTION_KEY and the OLD key as");
    console.error("               EVIDENCE_ENCRYPTION_KEY_PREVIOUS, then re-run.");
    process.exit(1);
  }
  console.log(`[rotate-key] current key ${info.version} (previous key present)`);
  const evidence = await reencryptEvidence();
  const webhooks = await reencryptWebhookSecrets();
  const mfa = await reencryptMfaSecrets();
  console.log(`[rotate-key] evidence objects re-sealed: ${evidence.rotated} (skipped: ${evidence.skipped})`);
  console.log(`[rotate-key] webhook secrets re-sealed: ${webhooks}`);
  console.log(`[rotate-key] MFA secrets re-sealed: ${mfa}`);
  if (evidence.skipped > 0) {
    console.warn("[rotate-key] WARNING: some artifacts could not be re-sealed — do NOT remove the previous key yet.");
    process.exit(2);
  }
  console.log("[rotate-key] OK — verify reads, then remove EVIDENCE_ENCRYPTION_KEY_PREVIOUS from the environment.");
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
