import { createHash } from "crypto";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { newId } from "@/lib/ids";
import { roleHas, type Permission, type Role } from "@/lib/rbac";
import { currentPrincipal, type Principal } from "@/lib/auth/session";

// API foundation: RFC 7807 problem responses, X-Request-ID correlation,
// Idempotency-Key handling, cursor pagination, authentication + permission guards.
// (PRD §9 API conventions)

export type ApiContext = {
  req: NextRequest;
  requestId: string;
  principal: Principal;
  orgId: string;
  role: Role;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public title: string,
    public detail?: string,
    public extras: Record<string, unknown> = {}
  ) {
    super(title);
  }
}

export function problem(status: number, code: string, title: string, detail?: string, extras: Record<string, unknown> = {}) {
  return Response.json(
    { type: `https://scopegraphx.dev/problems/${code}`, title, status, code, detail, ...extras },
    { status, headers: { "content-type": "application/problem+json" } }
  );
}

export function requestIdOf(req: NextRequest): string {
  return req.headers.get("x-request-id") || newId("req");
}

export function withRequestId(body: unknown, status: number, requestId: string, extraHeaders: Record<string, string> = {}): Response {
  return Response.json(body, {
    status,
    headers: { "x-request-id": requestId, ...extraHeaders },
  });
}

export async function requireContext(req: NextRequest, permission: Permission): Promise<ApiContext> {
  const requestId = requestIdOf(req);
  const principal = await currentPrincipal();
  if (!principal) throw new ApiError(401, "UNAUTHENTICATED", "Authentication required");
  if (!principal.orgId || !principal.role) throw new ApiError(403, "NO_ACTIVE_ORG", "Select an organization before using the API");
  if (!roleHas(principal.role as Role, permission)) {
    throw new ApiError(403, "FORBIDDEN", `Missing permission: ${permission}`, undefined, { permission });
  }
  return { req, requestId, principal, orgId: principal.orgId, role: principal.role as Role };
}

/** Idempotency-Key support for mutations: replay returns the stored response. */
export async function withIdempotency<T>(
  ctx: ApiContext,
  reqBody: unknown,
  fn: () => Promise<{ status: number; body: T }>
): Promise<{ status: number; body: T }> {
  const key = ctx.req.headers.get("idempotency-key");
  if (!key) return fn();
  const route = new URL(ctx.req.url).pathname;
  const requestHash = createHash("sha256").update(JSON.stringify(reqBody ?? null)).digest("hex");
  const recordId = `${ctx.orgId}:${route}:${key}`;
  const existing = await db.idempotencyRecord.findUnique({ where: { key: recordId } });
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new ApiError(422, "IDEMPOTENCY_KEY_REUSE", "Idempotency-Key already used with a different request body");
    }
    return { status: existing.responseStatus, body: JSON.parse(existing.responseBodyJson) as T };
  }
  const result = await fn();
  await db.idempotencyRecord.create({
    data: {
      key: recordId,
      orgId: ctx.orgId,
      route,
      requestHash,
      responseStatus: result.status,
      responseBodyJson: JSON.stringify(result.body),
    },
  });
  return result;
}

/** Cursor pagination: opaque base64 cursor of the last row id. */
export function parsePagination(url: URL, defaultLimit = 25, maxLimit = 100): { cursor: string | null; limit: number } {
  const cursor = url.searchParams.get("cursor");
  let limit = Number(url.searchParams.get("limit") || defaultLimit);
  if (!Number.isFinite(limit) || limit < 1) limit = defaultLimit;
  if (limit > maxLimit) limit = maxLimit;
  return { cursor, limit };
}

export function encodeCursor(lastId: string): string {
  return Buffer.from(JSON.stringify({ id: lastId }), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): string | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    return typeof parsed.id === "string" ? parsed.id : null;
  } catch {
    return null;
  }
}

export async function handleApiError(e: unknown, requestId: string): Promise<Response> {
  if (e instanceof ApiError) {
    return problem(e.status, e.code, e.title, e.detail, { ...e.extras, request_id: requestId });
  }
  console.error(`[api] unhandled error req=${requestId}`, e);
  return problem(500, "INTERNAL", "Internal server error", "An unexpected error occurred.");
}

