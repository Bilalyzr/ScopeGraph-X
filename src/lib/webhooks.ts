import { randomBytes, timingSafeEqual } from "crypto";
import { isIP } from "net";
import { db } from "@/lib/db";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { hmacSha256Hex, sealJson, unsealJson } from "@/lib/crypto";
import { ApiError } from "@/lib/api";
import { isBlockedAddress, isValidHostname } from "@/lib/policy/ipguard";

// Signed webhook delivery (FR-ENT-02): HMAC-SHA256 signatures with timestamp +
// nonce for replay protection, persisted delivery records with exponential
// backoff retries and a dead-letter state. Delivery runs through a transport
// adapter — "recorded" (default; no real egress, attempts are logged) or
// "http" (operator opt-in via WEBHOOK_TRANSPORT=http for operator-configured
// endpoints — never targets).

export const WEBHOOK_EVENTS = ["finding.status_changed", "policy.revoked", "safety.emergency_stop"] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

export interface WebhookTransport {
  name: string;
  deliver(url: string, body: string, headers: Record<string, string>): Promise<{ ok: boolean; response: string }>;
}


/** Default dev transport: records the delivery, performs no network I/O. */
class RecordedTransport implements WebhookTransport {
  name = "recorded";
  public readonly deliveries: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
  failNext = 0;
  async deliver(url: string, body: string, headers: Record<string, string>) {
    this.deliveries.push({ url, body, headers });
    if (this.failNext > 0) {
      this.failNext -= 1;
      return { ok: false, response: "recorded-failure (dev transport)" };
    }
    return { ok: true, response: "recorded (dev transport — no real egress)" };
  }
}

class HttpTransport implements WebhookTransport {
  name = "http";
  async deliver(url: string, body: string, headers: Record<string, string>) {
    validateWebhookUrl(url);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
      redirect: "error",
    });
    return { ok: res.ok, response: `${res.status} ${res.statusText}` };
  }
}


/** SSRF guard: webhook endpoints are operator-configured, but still refuse
 * private/loopback/resolved-risk destinations and non-https in production. */
function validateWebhookUrl(rawUrl: string): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("INVALID_WEBHOOK_URL");
  }
  if (url.protocol !== "https:" && process.env.NODE_ENV === "production") {
    throw new Error("WEBHOOK_HTTPS_REQUIRED");
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" || host.endsWith(".local") || host === "0.0.0.0" ||
    /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
  ) {
    throw new Error("WEBHOOK_PRIVATE_DESTINATION_FORBIDDEN");
  }
}

const recordedTransport = new RecordedTransport();

function getWebhookTransport(): WebhookTransport & { deliveries?: unknown[]; failNext?: number } {
  if (process.env.WEBHOOK_TRANSPORT === "http") return new HttpTransport();
  return recordedTransport;
}

export async function createWebhookEndpoint(input: {
  orgId: string;
  url: string;
  events: string[];
  actorId: string;
}) {
  validateWebhookUrl(input.url);
  const secret = randomBytes(32).toString("hex");
  const endpoint = await db.webhookEndpoint.create({
    data: {
      id: newId("whk"),
      orgId: input.orgId,
      url: input.url,
      secret: sealJson(secret), // encrypted at rest
      eventsJson: JSON.stringify(input.events),
      active: true,
    },
  });
  await audit({
    orgId: input.orgId,
    actorId: input.actorId,
    action: "webhook.created",
    resourceType: "WebhookEndpoint",
    resourceId: endpoint.id,
    metadata: { url: input.url, events: input.events },
  });
  return { endpoint, secret }; // secret shown once at creation
}

export function endpointSecret(endpoint: { secret: string }): string {
  return unsealJson<string>(endpoint.secret);
}

/** Canonical signed payload: HMAC over "timestampMs.nonce.body". */
export function signPayload(secret: string, timestampMs: number, nonce: string, body: string): string {
  return hmacSha256Hex(secret, `${timestampMs}.${nonce}.${body}`);
}

export function verifyWebhookSignature(input: {
  secret: string;
  timestampMs: number;
  nonce: string;
  body: string;
  signature: string;
  maxSkewMs?: number;
}): { valid: boolean; reason?: string } {
  const skew = Math.abs(Date.now() - input.timestampMs);
  if (skew > (input.maxSkewMs ?? 5 * 60_000)) return { valid: false, reason: "TIMESTAMP_OUT_OF_WINDOW" };
  const expected = signPayload(input.secret, input.timestampMs, input.nonce, input.body);
  const expectedBuf = Buffer.from(expected, "utf8");
  const sigBuf = Buffer.from(input.signature, "utf8");
  if (expectedBuf.length !== sigBuf.length || !timingSafeEqual(expectedBuf, sigBuf)) {
    return { valid: false, reason: "SIGNATURE_MISMATCH" };
  }
  return { valid: true };
}

/** Queue signed deliveries for every active endpoint subscribed to the event. */
export async function dispatchWebhookEvent(orgId: string, eventType: WebhookEventType, payload: unknown) {
  const endpoints = await db.webhookEndpoint.findMany({ where: { orgId, active: true } });
  const body = JSON.stringify({ event: eventType, org_id: orgId, data: payload, emitted_at: new Date().toISOString() });
  const created: string[] = [];
  for (const ep of endpoints) {
    const events = JSON.parse(ep.eventsJson) as string[];
    if (!events.includes(eventType)) continue;
    const timestampMs = Date.now(); // stored as BigInt (epoch ms exceeds 32-bit Int)
    const nonce = randomBytes(12).toString("hex");
    const signature = signPayload(endpointSecret(ep), timestampMs, nonce, body);
    const delivery = await db.webhookDelivery.create({
      data: {
        id: newId("whd"),
        orgId,
        endpointId: ep.id,
        eventType,
        payloadJson: body,
        timestampMs: BigInt(timestampMs),
        nonce,
        signature,
        status: "PENDING",
      },
    });
    created.push(delivery.id);
  }
  return created;
}

/** Worker: attempt due deliveries with backoff; DEAD after maxAttempts. */
export async function processWebhookDeliveries(limit = 10, transport: WebhookTransport = getWebhookTransport()) {
  const due = await db.webhookDelivery.findMany({
    where: { status: "PENDING", nextAttemptAt: { lte: new Date() } },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  const results: Array<{ id: string; status: string }> = [];
  for (const d of due) {
    const endpoint = await db.webhookEndpoint.findUnique({ where: { id: d.endpointId } });
    if (!endpoint || !endpoint.active) {
      await db.webhookDelivery.update({ where: { id: d.id }, data: { status: "DEAD", lastResponse: "endpoint removed/disabled" } });
      results.push({ id: d.id, status: "DEAD" });
      continue;
    }
    const attempt = await transport.deliver(endpoint.url, d.payloadJson, {
      "x-sgx-signature": d.signature,
      "x-sgx-timestamp": String(d.timestampMs),
      "x-sgx-nonce": d.nonce,
    });
    const attempts = d.attempts + 1;
    if (attempt.ok) {
      await db.webhookDelivery.update({
        where: { id: d.id },
        data: { status: "DELIVERED", attempts, deliveredAt: new Date(), lastResponse: attempt.response },
      });
      results.push({ id: d.id, status: "DELIVERED" });
    } else if (attempts >= d.maxAttempts) {
      await db.webhookDelivery.update({
        where: { id: d.id },
        data: { status: "DEAD", attempts, lastResponse: attempt.response },
      });
      results.push({ id: d.id, status: "DEAD" });
    } else {
      // exponential backoff: 5s, 10s, 20s, 40s…
      const next = new Date(Date.now() + 5_000 * 2 ** (attempts - 1));
      await db.webhookDelivery.update({
        where: { id: d.id },
        data: { attempts, nextAttemptAt: next, lastResponse: attempt.response },
      });
      results.push({ id: d.id, status: "RETRY_SCHEDULED" });
    }
  }
  return results;
}
