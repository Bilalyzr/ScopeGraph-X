import { describe, expect, it } from "vitest";
import { readFile } from "fs/promises";
import path from "path";
import { db } from "@/lib/db";
import { storeEvidence, readEvidence } from "@/lib/evidence/store";
import { captureSurface, recordAssetChanges, diffSurfaces, type AssetSurface } from "@/lib/discovery/changes";
import { createFixtures } from "../helpers";

describe("evidence encryption at rest (NFR-08)", () => {
  it("stores objects encrypted — plaintext never appears on disk", async () => {
    const fx = await createFixtures();
    const canary = `BEACON-PLAINTEXT-${fx.org.id}`;
    const { evidence } = await storeEvidence({
      orgId: fx.org.id, createdBy: fx.user.id, source: "test",
      content: { note: canary, nested: { deep: canary } },
    });
    const rel = evidence.encryptedObjectUri.replace("local://", "");
    const raw = await readFile(path.join(process.cwd(), ".data/test-evidence", ...rel.split("/")), "utf8");
    expect(raw).not.toContain(canary); // ciphertext only
    expect(JSON.parse(raw)).toMatchObject({ v: 1, iv: expect.any(String), tag: expect.any(String), ct: expect.any(String) });

    // Authorized read decrypts and verifies integrity
    const read = await readEvidence(fx.org.id, evidence.id);
    expect(read?.content).toContain(canary);
  });

  it("fails closed when the ciphertext is tampered on disk", async () => {
    const fx = await createFixtures();
    const { evidence } = await storeEvidence({
      orgId: fx.org.id, createdBy: fx.user.id, source: "test", content: { a: "b" },
    });
    const rel = evidence.encryptedObjectUri.replace("local://", "");
    const abs = path.join(process.cwd(), ".data/test-evidence", ...rel.split("/"));
    const sealed = JSON.parse(await readFile(abs, "utf8"));
    sealed.ct = (BigInt("0x" + sealed.ct) ^ 0xffn).toString(16).padStart(sealed.ct.length, "0");
    const { writeFile } = await import("fs/promises");
    await writeFile(abs, JSON.stringify(sealed), "utf8");
    await expect(readEvidence(fx.org.id, evidence.id)).resolves.toBeNull(); // GCM auth failure => null, not plaintext
  });
});

describe("change detection (FR-REC-03)", () => {
  it("first snapshot stores a baseline with no events", async () => {
    const fx = await createFixtures();
    const r = await recordAssetChanges(fx.assetShop.id);
    expect(r.changes).toBe(0);
  });

  it("emits NEW_ENDPOINT + SCOPE_STATE events on the next snapshot", async () => {
    const fx = await createFixtures();
    await recordAssetChanges(fx.assetShop.id); // baseline
    await db.endpoint.create({
      data: { id: "ep_new_1", assetId: fx.assetShop.id, method: "POST", routeTemplate: "/api/cart" },
    });
    await db.asset.update({ where: { id: fx.assetShop.id }, data: { scopeState: "OWNERSHIP_VERIFIED" } });
    const r = await recordAssetChanges(fx.assetShop.id);
    expect(r.changes).toBe(2);
    expect(r.diffs.map((d) => d.diffKind).sort()).toEqual(["NEW_ENDPOINT", "SCOPE_STATE"]);

    const rows = await db.assetChange.findMany({ where: { assetId: fx.assetShop.id }, orderBy: { id: "desc" } });
    const newEp = rows.find((c) => c.diffKind === "NEW_ENDPOINT");
    expect(JSON.parse(newEp!.afterJson)).toEqual({ method: "POST", routeTemplate: "/api/cart" });
    expect(newEp!.beforeJson).toBe("null");
  });

  it("identical surfaces produce no events (idempotent snapshots)", async () => {
    const fx = await createFixtures();
    await recordAssetChanges(fx.assetShop.id);
    expect((await recordAssetChanges(fx.assetShop.id)).changes).toBe(0);
  });

  it("diffSurfaces detects removed endpoints and attribute drift", () => {
    const before: AssetSurface = {
      endpoints: [{ method: "GET", routeTemplate: "/a" }, { method: "GET", routeTemplate: "/b" }],
      attributes: { scopeState: "DISCOVERED", confidence: 0.9, displayName: "x" },
    };
    const after: AssetSurface = {
      endpoints: [{ method: "GET", routeTemplate: "/a" }],
      attributes: { scopeState: "DISCOVERED", confidence: 0.4, displayName: "x" },
    };
    const diffs = diffSurfaces(before, after);
    expect(diffs.map((d) => d.diffKind).sort()).toEqual(["ATTRIBUTE", "REMOVED_ENDPOINT"]);
  });

  it("captures surfaces tenant-safely (unknown asset rejected)", async () => {
    await expect(captureSurface("ast_does_not_exist")).rejects.toThrow("ASSET_NOT_FOUND");
  });
});
