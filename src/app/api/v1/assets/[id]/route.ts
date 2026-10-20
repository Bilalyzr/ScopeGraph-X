import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ApiError, handleApiError, requireContext, withRequestId } from "@/lib/api";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req, "asset:read");
    const { id } = await params;
    const asset = await db.asset.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!asset) throw new ApiError(404, "NOT_FOUND", "Asset not found");
    const observations = await db.assetObservation.findMany({
      where: { assetId: id },
      orderBy: { observedAt: "desc" },
      take: 20,
    });
    const endpoints = await db.endpoint.findMany({ where: { assetId: id } });
    return withRequestId({ ...asset, observations, endpoints }, 200, ctx.requestId);
  } catch (e) {
    return handleApiError(e, "req");
  }
}

const patchSchema = z.object({
  scope_state: z.enum(["DISCOVERED", "ASSOCIATED", "OWNERSHIP_VERIFIED", "AUTHORIZED", "DENIED"]),
  authorization_note: z.string().max(500).default(""),
});

/**
 * Explicit asset authorization decision (FR-GRF-02): only a deliberate,
 * audited human decision moves an asset to AUTHORIZED. Discovery never does.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let requestId = "req";
  try {
    const ctx = await requireContext(req, "asset:write");
    requestId = ctx.requestId;
    const { id } = await params;
    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ApiError(422, "VALIDATION_ERROR", "Invalid asset update", parsed.error.issues[0]?.message);
    const asset = await db.asset.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!asset) throw new ApiError(404, "NOT_FOUND", "Asset not found");
    if (parsed.data.scope_state === "AUTHORIZED" && asset.scopeState !== "OWNERSHIP_VERIFIED") {
      throw new ApiError(422, "OWNERSHIP_NOT_VERIFIED", "Assets must be OWNERSHIP_VERIFIED before explicit testing authorization");
    }
    const updated = await db.asset.update({
      where: { id: asset.id },
      data: {
        scopeState: parsed.data.scope_state,
        authorizationNote: parsed.data.authorization_note || asset.authorizationNote,
      },
    });
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.principal.userId,
      action: "asset.scope_state_changed",
      resourceType: "Asset",
      resourceId: asset.id,
      decision: parsed.data.scope_state === "AUTHORIZED" ? "ALLOW" : "N/A",
      reason: parsed.data.authorization_note,
      metadata: { from: asset.scopeState, to: parsed.data.scope_state },
      requestRef: ctx.requestId,
    });
    return withRequestId(updated, 200, ctx.requestId);
  } catch (e) {
    return handleApiError(e, requestId);
  }
}
