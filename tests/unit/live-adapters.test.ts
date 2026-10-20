import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { newId } from "@/lib/ids";
import { collectLiveObservations, liveDiscoveryEnabled } from "@/lib/discovery/live";
import { createFixtures } from "../helpers";

function fakeResolver(ipmap: Record<string, string[]>) {
  return {
    resolve4: async (h: string) => {
      if (ipmap[h]?.[0]) return [ipmap[h][0]];
      throw new Error("ENOTFOUND");
    },
    resolve6: async (_h: string) => [] as string[],
  } as never;
}

function fakeFetch(responses: Record<string, unknown>) {
  return (async (url: string) => {
    for (const [prefix, body] of Object.entries(responses)) {
      if (url.startsWith(prefix)) {
        return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      }
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
}

describe("live passive adapters (env-gated, public records only)", () => {
  it("fails closed unless PASSIVE_DISCOVERY_MODE=live", async () => {
    expect(liveDiscoveryEnabled()).toBe(false);
    await expect(collectLiveObservations("org", "prg")).rejects.toThrow("LIVE_DISCOVERY_DISABLED");
  });

  it("queries only in-scope program assets and normalizes results", async () => {
    process.env.PASSIVE_DISCOVERY_MODE = "live";
    try {
      const fx = await createFixtures();
      // Register an apex DOMAIN asset (triggers CT+RDAP) plus the HOST assets.
      await db.asset.create({
        data: {
          id: newId("ast"), orgId: fx.org.id, programId: fx.program.id,
          canonicalLocator: "demo-target.test", assetType: "DOMAIN", scopeState: "DISCOVERED", confidence: 0.5,
        },
      });
      const observations = await collectLiveObservations(fx.org.id, fx.program.id, {
        resolver: fakeResolver({
          "shop.demo-target.test": ["203.0.113.10"],
          "admin.demo-target.test": ["203.0.113.12"],
          "staging.demo-target.test": ["203.0.113.99"],
          "demo-target.test": ["203.0.113.20"],
        }),
        fetch: fakeFetch({
          "https://crt.sh/?q=demo-target.test": [
            { issuer_name: "Let's Encrypt", common_name: "demo-target.test", name_value: "demo-target.test\nstaging.demo-target.test" },
          ],
          "https://rdap.org/domain/demo-target.test": {
            handle: "DOM-42", ldhName: "demo-target.test",
            events: [{ eventAction: "registration", eventDate: "2024-01-01T00:00:00Z" }],
          },
        }),
      });

      const sources = observations.map((o) => o.source);
      expect(sources).toContain("dns");
      expect(sources).toContain("ct");
      expect(sources).toContain("rdap");
      const ct = observations.find((o) => o.source === "ct")!;
      expect(ct.payload).toMatchObject({ discovered_names: ["staging.demo-target.test"] });
      expect(ct.note).toContain("NOT authorization"); // association never authorizes
      const rdap = observations.find((o) => o.source === "rdap")!;
      expect(rdap.assetType).toBe("DOMAIN");
      // Every source query was audited.
      const audits = await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) as count FROM AuditEvent WHERE action = 'discovery.source_query' AND orgId = ${fx.org.id}`;
      expect(Number(audits[0].count)).toBeGreaterThanOrEqual(4);
    } finally {
      process.env.PASSIVE_DISCOVERY_MODE = "mock";
    }
  });
});
