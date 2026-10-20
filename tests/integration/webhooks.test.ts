import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { newId } from "@/lib/ids";
import {
  createWebhookEndpoint, dispatchWebhookEvent, endpointSecret, processWebhookDeliveries,
  signPayload, verifyWebhookSignature, type WebhookTransport,
} from "@/lib/webhooks";
import { transitionFinding } from "@/lib/findings/lifecycle";
import { createFinding } from "@/lib/findings/lifecycle";
import { createFixtures } from "../helpers";

function failingTransport(): WebhookTransport {
  return {
    name: "always-fail-test",
    async deliver() {
      return { ok: false, response: "503 simulated outage" };
    },
  };
}

describe("webhook signatures (FR-ENT-02)", () => {
  it("signs and verifies the canonical payload", () => {
    const secret = "whsec_test";
    const body = JSON.stringify({ event: "finding.status_changed" });
    const ts = Date.now();
    const nonce = "n0nce";
    const sig = signPayload(secret, ts, nonce, body);
    expect(verifyWebhookSignature({ secret, timestampMs: ts, nonce, body, signature: sig }).valid).toBe(true);
  });

  it("rejects signature forgery and replay outside the time window", () => {
    const secret = "whsec_test";
    const body = '{"x":1}';
    const ts = Date.now();
    const sig = signPayload(secret, ts, "n1", body);
    expect(verifyWebhookSignature({ secret, timestampMs: ts, nonce: "n1", body, signature: "f00d" }).reason).toBe("SIGNATURE_MISMATCH");
    // Replay 10 minutes later is rejected even with a valid signature.
    expect(
      verifyWebhookSignature({ secret, timestampMs: ts - 10 * 60_000, nonce: "n1", body, signature: sig }).reason
    ).toBe("TIMESTAMP_OUT_OF_WINDOW");
  });

  it("body tampering invalidates the signature", () => {
    const secret = "s";
    const ts = Date.now();
    const sig = signPayload(secret, ts, "n", '{"a":1}');
    expect(verifyWebhookSignature({ secret, timestampMs: ts, nonce: "n", body: '{"a":2}', signature: sig }).valid).toBe(false);
  });
});

describe("webhook dispatch + delivery", () => {
  it("finding transitions fan out signed deliveries; recorded transport delivers", async () => {
    const fx = await createFixtures();
    const { endpoint } = await createWebhookEndpoint({
      orgId: fx.org.id, url: "https://example.test/hook",
      events: ["finding.status_changed"], actorId: fx.user.id,
    });
    expect(endpointSecret(endpoint)).toHaveLength(64); // stored encrypted, decrypts cleanly

    const finding = await createFinding({
      orgId: fx.org.id, programId: fx.program.id, category: "BOLA",
      title: `wh test ${newId("t").slice(-6)}`, description: "webhook test finding",
      severity: "LOW", confidence: 0.3, actorId: fx.user.id,
    });
    await transitionFinding({ findingId: finding.id, orgId: fx.org.id, to: "OBSERVED", role: "APPSEC_LEAD", actorId: fx.user.id });

    const pending = await db.webhookDelivery.findMany({ where: { orgId: fx.org.id, status: "PENDING" } });
    expect(pending).toHaveLength(1);
    expect(pending[0].eventType).toBe("finding.status_changed");
    // Signature on the delivery verifies against the endpoint secret.
    const ok = verifyWebhookSignature({
      secret: endpointSecret(endpoint),
      timestampMs: Number(pending[0].timestampMs),
      nonce: pending[0].nonce,
      body: pending[0].payloadJson,
      signature: pending[0].signature,
    });
    expect(ok.valid).toBe(true);

    const results = await processWebhookDeliveries(10);
    expect(results.find((r) => r.id === pending[0].id)?.status).toBe("DELIVERED");
  });

  it("retries with backoff and dead-letters after max attempts", async () => {
    const fx = await createFixtures();
    const { endpoint } = await createWebhookEndpoint({
      orgId: fx.org.id, url: "https://down.test/hook", events: ["policy.revoked"], actorId: fx.user.id,
    });
    void endpoint;
    await dispatchWebhookEvent(fx.org.id, "policy.revoked", { scope_id: "spv_x" });
    const delivery = (await db.webhookDelivery.findFirst({ where: { orgId: fx.org.id } }))!;

    const transport = failingTransport();
    // force max attempts small for the test
    await db.webhookDelivery.update({ where: { id: delivery.id }, data: { maxAttempts: 3 } });

    for (let round = 0; round < 3; round++) {
      await processWebhookDeliveries(10, transport);
      // simulate backoff elapsing so the next round is due
      await db.webhookDelivery.updateMany({
        where: { status: "PENDING" },
        data: { nextAttemptAt: new Date(Date.now() - 1000) },
      });
    }

    const final = await db.webhookDelivery.findUnique({ where: { id: delivery.id } });
    expect(final?.status).toBe("DEAD");
    expect(final?.attempts).toBe(3);
    expect(final?.lastResponse).toContain("503");
  });

  it("respects event subscriptions (no fan-out for unsubscribed events)", async () => {
    const fx = await createFixtures();
    await createWebhookEndpoint({
      orgId: fx.org.id, url: "https://example.test/hook",
      events: ["policy.revoked"], actorId: fx.user.id, // NOT finding.status_changed
    });
    await dispatchWebhookEvent(fx.org.id, "finding.status_changed", { finding_id: "f" });
    expect(await db.webhookDelivery.count({ where: { orgId: fx.org.id } })).toBe(0);
  });

  it("endpoints are tenant-scoped", async () => {
    const a = await createFixtures();
    const b = await createFixtures();
    await createWebhookEndpoint({ orgId: a.org.id, url: "https://a.test/h", events: ["policy.revoked"], actorId: a.user.id });
    await dispatchWebhookEvent(b.org.id, "policy.revoked", {});
    expect(await db.webhookDelivery.count({ where: { orgId: b.org.id } })).toBe(0);
  });
});
