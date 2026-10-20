import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import type { Evidence } from "@prisma/client";
import { db } from "@/lib/db";
import { newId } from "@/lib/ids";
import { redactJson, redactSecrets } from "./redact";
import { seal, unseal, type Sealed } from "@/lib/crypto";

// Content-addressed local evidence store (dev). Objects are encrypted at rest
// with AES-256-GCM (NFR-08); the DB row is the authoritative metadata. The
// sha256 remains over the REDACTED PLAINTEXT so integrity is verifiable after
// decryption, and content addressing stays stable.

const STORE_DIR = process.env.EVIDENCE_STORE_DIR || ".data/evidence";
const RETENTION_DAYS = Number(process.env.EVIDENCE_RETENTION_DAYS || 30);

export interface StoreEvidenceInput {
  orgId: string;
  createdBy: string;
  source: string;
  content: unknown;
  sensitivity?: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
  contentType?: string;
}

export async function storeEvidence(input: StoreEvidenceInput) {
  // Redact first — secrets never reach storage, encryption, or hashes of raw content.
  const { redacted, removed } =
    typeof input.content === "string" ? redactSecrets(input.content) : redactJson(input.content);
  const sha256 = createHash("sha256").update(redacted, "utf8").digest("hex");

  const existing = await db.evidence.findUnique({ where: { orgId_sha256: { orgId: input.orgId, sha256 } } });
  if (existing) return { evidence: existing, deduplicated: true, removed };

  // Tenant-scoped directory namespace: <dir>/<org>/<first2>/<sha256>
  const uri = path.posix.join(input.orgId, sha256.slice(0, 2), sha256);
  const abs = path.join(process.cwd(), STORE_DIR, ...uri.split("/"));
  await mkdir(path.dirname(abs), { recursive: true });
  // Encrypted at rest: the file body is a JSON envelope {v, iv, tag, ct}.
  await writeFile(abs, JSON.stringify(seal(redacted)), "utf8");

  const evidence = await db.evidence.create({
    data: {
      id: newId("evd"),
      orgId: input.orgId,
      sha256,
      encryptedObjectUri: `local://${uri}`,
      contentType: input.contentType ?? "application/json",
      sensitivity: input.sensitivity ?? "INTERNAL",
      source: input.source,
      collectedAt: new Date(),
      expiresAt: new Date(Date.now() + RETENTION_DAYS * 86400_000),
      redactionStatus: removed.length > 0 ? `REDACTED (${removed.map((r) => r.name).join(",")})` : "NO_SECRETS_FOUND",
      sizeBytes: Buffer.byteLength(redacted, "utf8"),
      createdBy: input.createdBy,
    },
  });
  return { evidence, deduplicated: false, removed };
}

/** Authorized read: decrypt, then verify content hash (integrity check on every read). */
export async function readEvidence(orgId: string, evidenceId: string): Promise<{ meta: Evidence; content: string } | null> {
  const meta = await db.evidence.findFirst({ where: { id: evidenceId, orgId } });
  if (!meta) return null;
  const rel = meta.encryptedObjectUri.replace("local://", "");
  const abs = path.join(process.cwd(), STORE_DIR, ...rel.split("/"));
  let raw: string;
  try {
    raw = await readFile(abs, "utf8");
  } catch {
    return null; // object missing from store — treat as unreadable
  }
  let content: string;
  try {
    content = unseal(JSON.parse(raw) as Sealed);
  } catch {
    return null; // wrong key or tampered ciphertext (GCM auth failure) — fail closed
  }
  const verify = createHash("sha256").update(content, "utf8").digest("hex");
  if (verify !== meta.sha256) throw new Error("INTEGRITY_FAILURE");
  return { meta, content };
}

/** Retention sweep — expires evidence past its retention window (NFR-07). */
export async function sweepExpiredEvidence(): Promise<number> {
  const expired = await db.evidence.findMany({
    where: { expiresAt: { lt: new Date() } },
    select: { id: true },
  });
  for (const e of expired) {
    await db.evidence.delete({ where: { id: e.id } }); // tombstone = DB row removal; object GC'd by ops
  }
  return expired.length;
}
