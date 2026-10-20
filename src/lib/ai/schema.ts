import { z } from "zod";

// Strict typed schema for AI outputs (FR-AI-01): 100% of model suggestions
// are schema-validated before anything downstream can read them.

const hypothesisSchema = z.object({
  category: z.enum([
    "BOLA", "BFLA", "AUTHENTICATION", "SESSION", "MISCONFIGURATION",
    "API_DRIFT", "WORKFLOW_VIOLATION", "SCHEMA_CORRELATION", "OTHER",
  ]),
  summary: z.string().min(10).max(500),
  assumptions: z.array(z.string()).min(1),
  evidence_ids: z.array(z.string()).max(20), // must reference existing evidence
  risk: z.string().min(5).max(800),
  proposed_validation: z.string().min(5).max(800),
  required_permissions: z.array(z.string()),
  expected_outcome: z.string().min(3).max(300),
  alternative_explanations: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  limitations: z.string().max(500),
});

export type HypothesisOutput = z.infer<typeof hypothesisSchema>;

/** Model output that fails this parse is rejected wholesale — no partial use. */
export function parseHypothesis(raw: unknown): HypothesisOutput | null {
  const result = hypothesisSchema.safeParse(raw);
  return result.success ? result.data : null;
}
