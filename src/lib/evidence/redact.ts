// Evidence redaction — credentials, tokens and common secret formats are
// removed BEFORE storage, indexing, model processing or export (PRD §J, §10).

const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "authorization-header", re: /Authorization:\s*Bearer\s+[A-Za-z0-9._~+/=-]+/gi },
  { name: "bearer-token", re: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g },
  { name: "basic-auth", re: /Authorization:\s*Basic\s+[A-Za-z0-9+/=]+/gi },
  { name: "set-cookie", re: /set-cookie:\s*[^\n\r]+/gi },
  { name: "cookie-header", re: /cookie:\s*[^\n\r]+/gi },
  { name: "api-key-assignment", re: /(["']?api[_-]?key["']?\s*[:=]\s*["']?)[A-Za-z0-9._-]{12,}(["']?)/gi },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { name: "private-key-block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "password-assignment", re: /(["']?password["']?\s*[:=]\s*["']?)[^\s"'&,}]{6,}(["']?)/gi },
];

export interface RedactionResult {
  redacted: string;
  removed: Array<{ name: string; count: number }>;
}

export function redactSecrets(input: string): RedactionResult {
  let output = input;
  const removed: Array<{ name: string; count: number }> = [];
  for (const { name, re } of SECRET_PATTERNS) {
    const matches = output.match(re);
    if (matches && matches.length > 0) {
      removed.push({ name, count: matches.length });
      output = output.replace(re, `[REDACTED:${name}]`);
    }
  }
  return { redacted: output, removed };
}

/** Redact structured JSON evidence (deep) — returns string + report of removals. */
export function redactJson(value: unknown): RedactionResult {
  return redactSecrets(JSON.stringify(value, null, 2));
}
