import { z } from "zod";

// OpenAPI schema import (FR-REC-02): normalize paths+methods from an
// OpenAPI 3.x document into endpoint inventory rows. Local parsing only —
// no fetch; the document arrives as pasted/uploaded JSON.

const openApiDocSchema = z.object({
  openapi: z.string().optional(),
  swagger: z.string().optional(),
  info: z.object({ title: z.string().optional(), version: z.string().optional() }).optional(),
  paths: z.record(z.string(), z.record(z.string(), z.unknown())),
});

const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

export interface NormalizedEndpoint {
  method: string;
  routeTemplate: string;
  operationId?: string;
}

export function parseOpenApiDocument(json: unknown): { title: string; version: string; endpoints: NormalizedEndpoint[] } {
  const doc = openApiDocSchema.parse(json);
  const endpoints: NormalizedEndpoint[] = [];
  for (const [route, pathItem] of Object.entries(doc.paths ?? {})) {
    for (const [method, op] of Object.entries(pathItem ?? {})) {
      if (!(METHODS as readonly string[]).includes(method)) continue; // skip parameters/servers keys
      const operation = op as { operationId?: string } | null;
      endpoints.push({
        method: method.toUpperCase(),
        routeTemplate: normalizeRoute(route),
        operationId: operation?.operationId,
      });
    }
  }
  endpoints.sort((a, b) => a.routeTemplate.localeCompare(b.routeTemplate) || a.method.localeCompare(b.method));
  return {
    title: doc.info?.title ?? "imported-api",
    version: doc.info?.version ?? "unknown",
    endpoints,
  };
}

/** Normalize a route to the internal template form: {param} braces, no trailing slash. */
export function normalizeRoute(route: string): string {
  let r = route.trim();
  if (!r.startsWith("/")) r = "/" + r;
  if (r.length > 1 && r.endsWith("/")) r = r.slice(0, -1);
  // convert :param and <param> to {param}
  r = r.replace(/[:<]([a-zA-Z0-9_]+)>?/g, "{$1}");
  return r;
}
