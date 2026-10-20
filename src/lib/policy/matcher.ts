import type { ScopeRules } from "./rules";

// Deny-priority scope matcher — FR-SCP-01: "deny overrides allow in conflicts".
// A request is allowed only if it matches at least one allow rule AND no deny rule.

export interface MatchTarget {
  host: string;
  path: string;
  method: string;
}

export interface MatchResult {
  allowed: boolean;
  matchedAllow?: { host: string };
  matchedDeny?: { host: string; reason: string };
}

function hostMatches(pattern: string, host: string): boolean {
  if (pattern === host) return true;
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(1); // ".example.com"
    return host.endsWith(suffix) && host.length > suffix.length;
  }
  return false;
}

function pathMatches(prefixes: string[], path: string): boolean {
  return prefixes.some((p) => p === "/" || path === p || path.startsWith(p.endsWith("/") ? p : p + "/") || path.startsWith(p));
}

function allowMatches(rule: { host: string; paths: string[]; methods: string[] }, t: MatchTarget): boolean {
  return (
    hostMatches(rule.host, t.host) &&
    pathMatches(rule.paths, t.path) &&
    rule.methods.includes(t.method.toUpperCase())
  );
}

export function matchScope(rules: ScopeRules, target: MatchTarget): MatchResult {
  // Deny first: any deny match blocks regardless of allow rules.
  for (const d of rules.deny) {
    if (!hostMatches(d.host, target.host)) continue;
    if (d.paths && d.paths.length > 0 && !pathMatches(d.paths, target.path)) continue;
    return { allowed: false, matchedDeny: { host: d.host, reason: d.reason || "Matched deny rule" } };
  }
  for (const a of rules.allow) {
    if (allowMatches(a, target)) {
      return { allowed: true, matchedAllow: { host: a.host } };
    }
  }
  return { allowed: false };
}

/** Explain a match for UI surfaces ("why was this denied?"). */
export function explainMatch(rules: ScopeRules, target: MatchTarget): string {
  const r = matchScope(rules, target);
  if (r.allowed) return `Allowed by rule ${r.matchedAllow!.host}`;
  if (r.matchedDeny) return `Denied by rule ${r.matchedDeny.host}: ${r.matchedDeny.reason}`;
  return "No allow rule matches this host/path/method";
}
