import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handleApiError, requireContext, withRequestId, ApiError } from "@/lib/api";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req, "program:read");
    const { id } = await params;
    const program = await db.program.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!program) throw new ApiError(404, "NOT_FOUND", "Program not found");
    const scopeVersions = await db.scopeVersion.findMany({
      where: { programId: id },
      orderBy: { version: "desc" },
    });
    return withRequestId({ ...program, object: "program", scope_versions: scopeVersions.map((v) => ({ ...v, rules: JSON.parse(v.rulesJson) })) }, 200, ctx.requestId);
  } catch (e) {
    return handleApiError(e, "req");
  }
}
