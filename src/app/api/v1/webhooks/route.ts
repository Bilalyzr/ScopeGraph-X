import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { createWebhookEndpoint, WEBHOOK_EVENTS, processWebhookDeliveries } from "@/lib/webhooks";
import { ApiError, handleApiError, requireContext, withRequestId } from "@/lib/api";

// Webhook endpoint management (FR-ENT-02). Secrets are shown ONCE at creation
// and stored encrypted. Dev transport is "recorded" — no real egress unless an
// operator explicitly sets WEBHOOK_TRANSPORT=http.

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireContext(req, "org:admin");
    const endpoints = await db.webhookEndpoint.findMany({ where: { orgId: ctx.orgId }, orderBy: { createdAt: "desc" } });
    const deliveries = await db.webhookDelivery.findMany({ where: { orgId: ctx.orgId }, orderBy: { createdAt: "desc" }, take: 25 });
    return withRequestId({
      transport: process.env.WEBHOOK_TRANSPORT === "http" ? "http" : "recorded (no real egress)",
      available_events: WEBHOOK_EVENTS,
      endpoints: endpoints.map((e) => ({ id: e.id, url: e.url, events: JSON.parse(e.eventsJson), active: e.active, created_at: e.createdAt })),
      recent_deliveries: deliveries.map((d) => ({
        id: d.id, event: d.eventType, status: d.status, attempts: d.attempts,
        last_response: d.lastResponse, next_attempt_at: d.nextAttemptAt,
      })),
    }, 200, ctx.requestId);
  } catch (e) {
    return handleApiError(e, "req");
  }
}

const createSchema = z.object({
  url: z.string().url().max(500),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
});

export async function POST(req: NextRequest) {
  let requestId = "req";
  try {
    const ctx = await requireContext(req, "org:admin");
    requestId = ctx.requestId;
    const parsed = createSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ApiError(422, "VALIDATION_ERROR", "url and events required", parsed.error.issues[0]?.message);
    const { endpoint, secret } = await createWebhookEndpoint({
      orgId: ctx.orgId, url: parsed.data.url, events: parsed.data.events, actorId: ctx.principal.userId,
    });
    return withRequestId(
      { id: endpoint.id, url: endpoint.url, events: parsed.data.events, secret_shown_once: secret,
        note: "Store the signing secret now. Verify deliveries with HMAC-SHA256 over 'timestampMs.nonce.body' (headers x-sgx-signature/timestamp/nonce); reject skew > 5 min." },
      201, ctx.requestId
    );
  } catch (e) {
    return handleApiError(e, requestId);
  }
}

const patchSchema = z.object({ id: z.string().min(1), active: z.boolean() });

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireContext(req, "org:admin");
    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ApiError(422, "VALIDATION_ERROR", "id and active required");
    const endpoint = await db.webhookEndpoint.findFirst({ where: { id: parsed.data.id, orgId: ctx.orgId } });
    if (!endpoint) throw new ApiError(404, "NOT_FOUND", "Webhook endpoint not found");
    await db.webhookEndpoint.update({ where: { id: endpoint.id }, data: { active: parsed.data.active } });
    return withRequestId({ id: endpoint.id, active: parsed.data.active }, 200, ctx.requestId);
  } catch (e) {
    return handleApiError(e, "req");
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireContext(req, "org:admin");
    const id = new URL(req.url).searchParams.get("id");
    if (!id) throw new ApiError(422, "VALIDATION_ERROR", "id query parameter required");
    const endpoint = await db.webhookEndpoint.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!endpoint) throw new ApiError(404, "NOT_FOUND", "Webhook endpoint not found");
    await db.webhookEndpoint.delete({ where: { id: endpoint.id } });
    await db.webhookDelivery.updateMany({ where: { endpointId: endpoint.id, status: "PENDING" }, data: { status: "DEAD", lastResponse: "endpoint deleted" } });
    return withRequestId({ deleted: endpoint.id }, 200, ctx.requestId);
  } catch (e) {
    return handleApiError(e, "req");
  }
}

/** Dev: drain pending deliveries now (worker normally does this). */
export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireContext(req, "org:admin");
    void ctx;
    const results = await processWebhookDeliveries(25);
    return withRequestId({ processed: results }, 200, "drain");
  } catch (e) {
    return handleApiError(e, "req");
  }
}
