import { Resolver } from "dns/promises";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { PassiveObservation } from "./passive";

// LIVE passive discovery adapters (FR-REC-01). Enabled ONLY when
// PASSIVE_DISCOVERY_MODE=live. These query PUBLIC record infrastructure —
// DNS resolvers, certificate-transparency logs (crt.sh), RDAP directories —
// for hosts that are ALREADY registered assets of an ACTIVE program in the
// caller's org. They never send requests to the targets themselves; this is
// passive reconnaissance per PRD §2.1, and every source query is audited.
// Default mode remains deterministic fixtures (mock).

type FetchLike = typeof fetch;

export function liveDiscoveryEnabled(): boolean {
  return process.env.PASSIVE_DISCOVERY_MODE === "live";
}

/** Hosts eligible for live lookups: assets of this org's ACTIVE programs. */
async function eligibleHosts(orgId: string, programId: string): Promise<Set<string>> {
  const assets = await db.asset.findMany({
    where: { orgId, programId },
    select: { canonicalLocator: true, assetType: true },
  });
  return new Set(assets.filter((a) => ["HOST", "DOMAIN"].includes(a.assetType)).map((a) => a.canonicalLocator.toLowerCase()));
}

async function dnsObservation(resolver: Resolver, host: string): Promise<PassiveObservation | null> {
  try {
    const [a, aaaa] = await Promise.all([
      resolver.resolve4(host).catch(() => [] as string[]),
      resolver.resolve6(host).catch(() => [] as string[]),
    ]);
    if (a.length === 0 && aaaa.length === 0) return null;
    return {
      source: "dns",
      locator: host,
      assetType: "HOST",
      confidence: 0.95,
      payload: { record: "A/AAAA", ipv4: a, ipv6: aaaa },
      note: "live DNS resolution (public resolver)",
    };
  } catch {
    return null;
  }
}

interface CrtShRow { issuer_name?: string; common_name?: string; name_value?: string }

async function ctObservation(fetchFn: FetchLike, host: string): Promise<PassiveObservation | null> {
  try {
    const url = `https://crt.sh/?q=${encodeURIComponent(host)}&output=json`;
    const res = await fetchFn(url, { headers: { "user-agent": "ScopeGraphX-PassiveDiscovery/1.0" }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const rows = (await res.json()) as CrtShRow[];
    const names = new Set<string>();
    for (const r of rows.slice(0, 200)) {
      for (const n of (r.name_value ?? "").split("\n")) {
        const clean = n.trim().toLowerCase();
        // Only keep subdomains of the queried host — association signal, never authorization.
        if (clean.endsWith("." + host) && clean.length > host.length + 1) names.add(clean);
      }
    }
    if (names.size === 0) return null;
    return {
      source: "ct",
      locator: host,
      assetType: "HOST",
      confidence: 0.7,
      payload: { cert_issuer: rows[0]?.issuer_name ?? "", discovered_names: [...names].slice(0, 50) },
      note: `certificate transparency: ${names.size} associated subdomain(s) — association only, NOT authorization`,
    };
  } catch {
    return null;
  }
}

interface RdapDoc { handle?: string; ldhName?: string; events?: Array<{ eventAction?: string; eventDate?: string }> }

async function rdapObservation(fetchFn: FetchLike, domain: string): Promise<PassiveObservation | null> {
  try {
    const url = `https://rdap.org/domain/${encodeURIComponent(domain)}`;
    const res = await fetchFn(url, { headers: { accept: "application/rdap+json" }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const doc = (await res.json()) as RdapDoc;
    if (!doc.ldhName) return null;
    return {
      source: "rdap",
      locator: doc.ldhName.toLowerCase(),
      assetType: "DOMAIN",
      confidence: 0.85,
      payload: {
        handle: doc.handle ?? "",
        events: (doc.events ?? []).slice(0, 10).map((e) => ({ action: e.eventAction ?? "", date: e.eventDate ?? "" })),
      },
      note: "live RDAP registration data",
    };
  } catch {
    return null;
  }
}

export interface LiveAdapterDeps {
  resolver?: Resolver;
  fetch?: FetchLike;
}

/** Collect live passive observations for all in-scope hosts of the program. */
export async function collectLiveObservations(
  orgId: string,
  programId: string,
  deps: LiveAdapterDeps = {}
): Promise<PassiveObservation[]> {
  if (!liveDiscoveryEnabled()) {
    throw new Error("LIVE_DISCOVERY_DISABLED"); // fail closed: callers must check first
  }
  const resolver = deps.resolver ?? new Resolver();
  const fetchFn = deps.fetch ?? fetch;
  const eligible = await eligibleHosts(orgId, programId);
  const observations: PassiveObservation[] = [];

  for (const host of eligible) {
    const looked: string[] = [];
    const dns = await dnsObservation(resolver, host);
    looked.push("dns");
    if (dns) observations.push(dns);
    if (!host.includes(".") || host.split(".").length < 2) continue;
    const parent = host.split(".").slice(-2).join(".");
    const isApex = host === parent;
    if (isApex) {
      const ct = await ctObservation(fetchFn, host);
      const rdap = await rdapObservation(fetchFn, host);
      looked.push("ct", "rdap");
      if (ct) observations.push(ct);
      if (rdap) observations.push(rdap);
    }
    await audit({
      orgId,
      actorType: "SERVICE",
      actorId: "worker/passive-live",
      action: "discovery.source_query",
      resourceType: "Asset",
      resourceId: host,
      metadata: { sources: looked, program: programId, mode: "live-public-records" },
    });
  }
  return observations;
}
