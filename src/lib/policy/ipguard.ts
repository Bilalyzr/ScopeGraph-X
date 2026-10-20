import { isIP } from "net";

// Destination address classification — block private/loopback/link-local/
// reserved ranges by default (SSRF mitigation, PRD §10 threat "SSRF via scan planner").

export type AddressClass =
  | "PUBLIC"
  | "LOOPBACK"
  | "PRIVATE"
  | "LINK_LOCAL"
  | "UNIQUE_LOCAL"
  | "RESERVED"
  | "MULTICAST"
  | "INVALID";

export function classifyIp(ip: string): AddressClass {
  if (!isIP(ip)) return "INVALID";
  if (isIP(ip) === 4) return classifyV4(ip);
  return classifyV6(ip);
}

function octets(ip: string): number[] {
  return ip.split(".").map(Number);
}

function classifyV4(ip: string): AddressClass {
  const [a, b] = octets(ip);
  if (a === 127) return "LOOPBACK";
  if (a === 10) return "PRIVATE";
  if (a === 192 && b === 168) return "PRIVATE";
  if (a === 172 && b >= 16 && b <= 31) return "PRIVATE";
  if (a === 169 && b === 254) return "LINK_LOCAL";
  if (a === 0) return "RESERVED";
  if (a === 100 && b >= 64 && b <= 127) return "PRIVATE"; // CGNAT
  if (a >= 224) return "RESERVED";
  if (a === 192 && b === 0) return "RESERVED"; // 192.0.0.0/24 + 192.0.2.0/24 test nets
  if (a === 198 && (b === 18 || b === 19)) return "RESERVED";
  return "PUBLIC";
}

function classifyV6(ip: string): AddressClass {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::" || /^(0+:){7}0*1$/.test(lower) || /^(0+:){7}0+$/.test(lower)) {
    return "LOOPBACK";
  }
  if (lower.startsWith("fe80:")) return "LINK_LOCAL";
  if (lower.startsWith("fc") || lower.startsWith("fd")) return "UNIQUE_LOCAL";
  if (lower.startsWith("ff")) return "MULTICAST";
  if (lower.startsWith("::ffff:") || /^(0+:){5}ffff:/.test(lower)) {
    const tail = lower.replace(/^.*ffff:/, "");
    if (tail.includes(".")) return classifyV4(tail);
    const parts = tail.split(":");
    if (parts.length === 2) {
      const hi = parseInt(parts[0], 16);
      const lo = parseInt(parts[1], 16);
      if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
        return classifyV4(`${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`);
      }
    }
    return "RESERVED";
  }
  if (lower.startsWith("2001:db8")) return "RESERVED"; // documentation
  if (lower.startsWith("64:ff9b")) return "RESERVED";
  return "PUBLIC";
}

const BLOCKED_CLASSES: AddressClass[] = [
  "INVALID", "LOOPBACK", "PRIVATE", "LINK_LOCAL", "UNIQUE_LOCAL", "RESERVED", "MULTICAST",
];

export function isBlockedAddress(ip: string): boolean {
  return BLOCKED_CLASSES.includes(classifyIp(ip));
}

/** Hostname syntax validation — blocks malformed hosts before resolution. */
export function isValidHostname(host: string): boolean {
  if (host.length === 0 || host.length > 253) return false;
  if (isIP(host) !== 0) return isIP(host) === 4 || isIP(host) === 6;
  const labels = host.split(".");
  if (labels.some((l) => l.length === 0 || l.length > 63)) return false;
  return labels.every((l) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(l));
}

/**
 * Deterministic simulated resolver (dev fixtures). No real DNS is performed.
 * Supports rebinding fixtures: a host listed in REBINDING_HOSTS alternates
 * between a public and a private address across calls, so tests can prove the
 * gateway revalidates at the egress point instead of trusting an earlier check.
 */
const DNS_FIXTURES: Record<string, string[]> = {
  "shop.demo-target.test": ["203.0.113.10"],
  "api.demo-target.test": ["203.0.113.11"],
  "admin.demo-target.test": ["203.0.113.12"],
  "rebind.demo-target.test": ["203.0.113.13", "10.0.0.66"], // DNS rebinding fixture
  "internal.corp.test": ["10.1.2.3"],
};

const rebindCounters = new Map<string, number>();

export function simulatedResolve(host: string): string[] {
  const fixture = DNS_FIXTURES[host];
  if (!fixture) return [];
  if (fixture.length === 1) return fixture;
  const n = rebindCounters.get(host) ?? 0;
  rebindCounters.set(host, n + 1);
  return [fixture[n % fixture.length]];
}

/** Register an additional fixture (used by tests). */
export function registerDnsFixture(host: string, ips: string[]): void {
  DNS_FIXTURES[host] = ips;
  rebindCounters.delete(host);
}
