import { z } from "zod";

// Structured scope rules for a policy (scope_version.rules_json) — FR-SCP-01.

const hostPatternSchema = z
  .string()
  .min(1)
  .refine((h) => !h.includes("/") && !h.includes(" "), "Invalid host pattern");

const allowRuleSchema = z.object({
  host: hostPatternSchema, // exact host or *.suffix wildcard
  paths: z.array(z.string()).default(["/"]), // prefix match; ["/"] means all
  methods: z.array(z.string().toUpperCase()).default(["GET"]),
});

const denyRuleSchema = z.object({
  host: hostPatternSchema,
  paths: z.array(z.string()).optional(),
  reason: z.string().default(""),
});

const budgetsSchema = z.object({
  max_requests: z.number().int().positive(),
  max_rps: z.number().positive(),
  max_concurrency: z.number().int().positive(),
});

export const scopeRulesSchema = z.object({
  allow: z.array(allowRuleSchema).min(1),
  deny: z.array(denyRuleSchema).default([]),
  budgets: budgetsSchema,
  notes: z.string().default(""),
});

export type ScopeRules = z.infer<typeof scopeRulesSchema>;
export type AllowRule = z.infer<typeof allowRuleSchema>;
export type DenyRule = z.infer<typeof denyRuleSchema>;

export function parseRules(json: string): ScopeRules {
  return scopeRulesSchema.parse(JSON.parse(json));
}

