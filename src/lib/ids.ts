import { randomBytes } from "crypto";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Prefixed opaque identifiers matching PRD conventions (prg_…, spv_…, cmp_…). */
export function newId(prefix: string): string {
  const bytes = randomBytes(12);
  let s = "";
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${s}`;
}
