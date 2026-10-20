import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { addEdge } from "@/lib/graph/projection";
import { ApiError, decodeCursor, encodeCursor, handleApiError, parsePagination, requireContext, withRequestId } from "@/lib/api";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireContext(req, "asset:read");
    const url = new URL(req.url);
    const { cursor, limit } = parsePagination(url);
    const programId = url.searchParams.get("program_id");
    const scopeState = url.searchParams.get("scope_state");
    const rows = await db.asset.findMany({
      where: {
        orgId: ctx.orgId,
        ...(programId ? { programId } : {}),
        ...(scopeState ? { scopeState } : {}),
        ...(cursor ? { id: { lt: decodeCursor(cursor) ?? cursor } } : {}),
      },
      orderBy: { id: "desc" },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const data = rows.slice(0, limit);
    return withRequestId({
      data,
      pagination: hasMore ? { next_cursor: encodeCursor(data[data.length - 1].id) } : undefined,
    }, 200, ctx.requestId);
  } catch (e) {
    return handleApiError(e, "req");
  }
}

const createSchema = z.object({
  program_id: z.string().min(1),
  canonical_locator: z.string().min(3).max(253),
  asset_type: z.enum(["HOST", "DOMAIN", "IP", "WEB_APP", "API", "CLOUD_CONFIG"]).default("HOST"),
  note: z.string().max(500).default(""),
});

/** Manual asset import (FR-REC-02) — assets enter as DISCOVERED, never authorized. */
export async function POST(req: NextRequest) {
  let requestId = "req";
  try {
    const ctx = await requireContext(req, "asset:write");
    requestId = ctx.requestId;
    const parsed = createSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ApiError(422, "VALIDATION_ERROR", "Invalid asset payload", parsed.error.issues[0]?.message);
    const program = await db.program.findFirst({ where: { id: parsed.data.program_id, orgId: ctx.orgId } });
    if (!program) throw new ApiError(404, "NOT_FOUND", "Program not found");
    const locator = parsed.data.canonical_locator.trim().toLowerCase();
    const existing = await db.asset.findUnique({
      where: { programId_canonicalLocator_assetType: { programId: program.id, canonicalLocator: locator, assetType: parsed.data.asset_type } },
    });
    if (existing) throw new ApiError(409, "ASSET_EXISTS", "Asset already exists in this program", undefined, { asset_id: existing.id });
    const asset = await db.asset.create({
      data: {
        id: newId("ast"),
        orgId: ctx.orgId,
        programId: program.id,
        canonicalLocator: locator,
        assetType: parsed.data.asset_type,
        displayName: locator,
        scopeState: "DISCOVERED",
        authorizationNote: parsed.data.note,
        confidence: 0.5,
      },
    });
    await db.assetObservation.create({
      data: {
        id: newId("aob"), assetId: asset.id, source: "manual",
        confidence: 0.5, payloadJson: JSON.stringify({ imported_by: ctx.principal.userId }),
        note: "Manual import",
      },
    });
    await addEdge({
      orgId: ctx.orgId, sourceType: "Asset", sourceId: asset.id, relation: "IN_SCOPE_OF",
      targetType: "Program", targetId: program.id, confidence: 0.5, policyContext: "manual-import",
    });
    await audit({
      orgId: ctx.orgId, actorId: ctx.principal.userId, action: "asset.imported",
      resourceType: "Asset", resourceId: asset.id, decision: "ALLOW",
      metadata: { locator, program: program.id }, requestRef: ctx.requestId,
    });
    return withRequestId(asset, 201, ctx.requestId);
  } catch (e) {
    return handleApiError(e, requestId);
  }
}
