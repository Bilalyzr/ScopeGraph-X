import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { parseOpenApiDocument } from "@/lib/detection/openapi";
import { recordAssetChanges } from "@/lib/discovery/changes";
import { ApiError, handleApiError, requireContext, withRequestId } from "@/lib/api";

// OpenAPI schema import (FR-REC-02): paste an OpenAPI/Swagger JSON document;
// paths+methods are normalized into the endpoint inventory of an asset and a
// change snapshot is captured (which surfaces NEW_ENDPOINT change events).

const schema = z.object({
  asset_id: z.string().min(1),
  document: z.record(z.string(), z.unknown()),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let requestId = "req";
  try {
    const ctx = await requireContext(req, "asset:write");
    requestId = ctx.requestId;
    const { id } = await params;
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ApiError(422, "VALIDATION_ERROR", "asset_id and document required");

    const program = await db.program.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!program) throw new ApiError(404, "NOT_FOUND", "Program not found");
    const asset = await db.asset.findFirst({ where: { id: parsed.data.asset_id, programId: program.id } });
    if (!asset) throw new ApiError(404, "NOT_FOUND", "Asset not found in this program");

    let doc;
    try {
      doc = parseOpenApiDocument(parsed.data.document);
    } catch (err) {
      throw new ApiError(422, "INVALID_OPENAPI", "Document does not look like OpenAPI/Swagger JSON", err instanceof Error ? err.message : undefined);
    }
    if (doc.endpoints.length === 0) throw new ApiError(422, "NO_PATHS", "Document contains no path operations");

    let created = 0;
    let duplicates = 0;
    for (const ep of doc.endpoints) {
      const existing = await db.endpoint.findUnique({
        where: { assetId_method_routeTemplate: { assetId: asset.id, method: ep.method, routeTemplate: ep.routeTemplate } },
      });
      if (existing) {
        duplicates += 1;
        continue;
      }
      await db.endpoint.create({
        data: {
          id: newId("ept"),
          assetId: asset.id,
          method: ep.method,
          routeTemplate: ep.routeTemplate,
          schemaRef: `${doc.title}/${doc.version}${ep.operationId ? `#${ep.operationId}` : ""}`,
        },
      });
      created += 1;
    }

    // Snapshot after import -> emits NEW_ENDPOINT change events for the feed.
    const changeResult = await recordAssetChanges(asset.id);

    await audit({
      orgId: ctx.orgId,
      actorId: ctx.principal.userId,
      action: "schema.imported",
      resourceType: "Asset",
      resourceId: asset.id,
      decision: "ALLOW",
      metadata: { title: doc.title, version: doc.version, endpoints: doc.endpoints.length, created, duplicates, changes: changeResult.changes },
      requestRef: ctx.requestId,
    });

    return withRequestId({
      title: doc.title,
      version: doc.version,
      endpoints_total: doc.endpoints.length,
      endpoints_created: created,
      duplicates,
      change_events: changeResult.changes,
    }, 201, ctx.requestId);
  } catch (e) {
    return handleApiError(e, requestId);
  }
}
