import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { buildReportData, reportToHtml, reportToJson, reportToPdf } from "@/lib/reports/generate";
import { storeEvidence } from "@/lib/evidence/store";
import { ApiError, handleApiError, requireContext, withRequestId } from "@/lib/api";

// POST /v1/reports — generate a reviewed report export (report:write).
// Only REVIEWED/REPORTED/ACCEPTED findings with validation are included;
// export requires prior researcher review (FR-FND-02).

export async function POST(req: NextRequest) {
  let requestId = "req";
  try {
    const ctx = await requireContext(req, "report:write");
    requestId = ctx.requestId;
    const parsed = z
      .object({ program_id: z.string().min(1), format: z.enum(["json", "html", "pdf"]).default("json") })
      .safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ApiError(422, "VALIDATION_ERROR", "program_id required");

    const program = await db.program.findFirst({ where: { id: parsed.data.program_id, orgId: ctx.orgId } });
    if (!program) throw new ApiError(404, "NOT_FOUND", "Program not found");

    // Safety gate: unreviewed findings must not silently enter an export.
    const unreviewed = await db.finding.count({ where: { programId: program.id, status: "PROPOSED" } });
    if (unreviewed > 0 && parsed.data.format !== "json") {
      // JSON debug export allowed; human-facing formats require review first.
      throw new ApiError(409, "UNREVIEWED_FINDINGS", `${unreviewed} finding(s) are still PROPOSED; review them before exporting ${parsed.data.format.toUpperCase()}`);
    }

    const data = await buildReportData(program.id, ctx.orgId, ctx.principal.userId);

    // Persist the report body as content-addressed evidence for traceability.
    const bodyJson = parsed.data.format === "json" ? reportToJson(data) : JSON.stringify(data);
    const { evidence } = await storeEvidence({
      orgId: ctx.orgId,
      createdBy: ctx.principal.userId,
      source: "report-export",
      content: JSON.parse(bodyJson),
      sensitivity: "CONFIDENTIAL",
    });

    await audit({
      orgId: ctx.orgId, actorId: ctx.principal.userId, action: "report.generated",
      resourceType: "Report", resourceId: data.id, decision: "ALLOW",
      metadata: { program: program.id, format: parsed.data.format, findings: data.findings.length, evidence: evidence.id },
      requestRef: ctx.requestId,
    });

    if (parsed.data.format === "pdf") {
      const pdf = await reportToPdf(data);
      return new Response(pdf as BodyInit, {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `attachment; filename="scopegraph-report-${data.id}.pdf"`,
          "x-request-id": ctx.requestId,
          "x-report-id": data.id,
          "x-evidence-id": evidence.id,
        },
      });
    }
    if (parsed.data.format === "html") {
      return new Response(reportToHtml(data), {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "x-request-id": ctx.requestId,
          "x-report-id": data.id,
          "x-evidence-id": evidence.id,
        },
      });
    }
    return withRequestId({ ...data, evidence_id: evidence.id }, 200, ctx.requestId);
  } catch (e) {
    return handleApiError(e, requestId);
  }
}
