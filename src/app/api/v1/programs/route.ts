import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { handleApiError, parsePagination, requireContext, withIdempotency, withRequestId, decodeCursor, encodeCursor, ApiError } from "@/lib/api";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireContext(req, "program:read");
    const { cursor, limit } = parsePagination(new URL(req.url));
    const rows = await db.program.findMany({
      where: { orgId: ctx.orgId, ...(cursor ? { id: { lt: decodeCursor(cursor) ?? cursor } } : {}) },
      orderBy: { id: "desc" },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const data = rows.slice(0, limit);
    return withRequestId({
      data: data.map((p) => ({ ...p, object: "program" })),
      pagination: hasMore ? { next_cursor: encodeCursor(data[data.length - 1].id) } : undefined,
    }, 200, ctx.requestId);
  } catch (e) {
    return handleApiError(e, "req");
  }
}

const createSchema = z.object({
  name: z.string().min(3).max(120),
  handle: z.string().regex(/^[a-z0-9-]+$/, "lowercase letters, digits and dashes"),
  provider: z.enum(["manual", "hackerone", "bugcrowd", "internal"]).default("manual"),
  description: z.string().max(2000).default(""),
  authorization_ref: z.string().min(3).max(500),
});

export async function POST(req: NextRequest) {
  let requestId = "req";
  try {
    const ctx = await requireContext(req, "program:write");
    requestId = ctx.requestId;
    const body = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(422, "VALIDATION_ERROR", "Invalid program payload", parsed.error.issues[0]?.message);
    const result = await withIdempotency(ctx, body, async () => {
      const existing = await db.program.findUnique({
        where: { orgId_provider_handle: { orgId: ctx.orgId, provider: parsed.data.provider, handle: parsed.data.handle } },
      });
      if (existing) throw new ApiError(409, "PROGRAM_EXISTS", "A program with this provider+handle already exists");
      const program = await db.program.create({
        data: {
          id: newId("prg"),
          orgId: ctx.orgId,
          provider: parsed.data.provider,
          handle: parsed.data.handle,
          name: parsed.data.name,
          description: parsed.data.description,
          authorizationRef: parsed.data.authorization_ref,
          state: "DRAFT",
          createdBy: ctx.principal.userId,
        },
      });
      await audit({
        orgId: ctx.orgId,
        actorId: ctx.principal.userId,
        action: "program.created",
        resourceType: "Program",
        resourceId: program.id,
        decision: "ALLOW",
        metadata: { handle: program.handle, provider: program.provider },
        requestRef: ctx.requestId,
      });
      return { status: 201 as const, body: { ...program, object: "program" } };
    });
    return withRequestId(result.body, result.status, ctx.requestId);
  } catch (e) {
    return handleApiError(e, requestId);
  }
}
