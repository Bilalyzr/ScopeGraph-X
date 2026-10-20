import { describe, expect, it } from "vitest";
import { OpenAICompatibleProvider } from "@/lib/ai/provider";
import { SYSTEM_PROMPT } from "@/lib/ai/injection";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function chatResponse(content: string): Response {
  return jsonResponse({ choices: [{ message: { content } }] });
}

const VALID_HYPOTHESIS_JSON = JSON.stringify([
  {
    category: "BOLA",
    summary: "Cross-tenant order read suspected from fixture evidence",
    assumptions: ["missing object-level check"],
    evidence_ids: ["evd_1"],
    risk: "tenant data exposure",
    proposed_validation: "differential check with provisioned identities",
    required_permissions: ["test:propose"],
    expected_outcome: "expected DENY, observed 2xx supports hypothesis",
    alternative_explanations: ["fixture mis-provisioning"],
    confidence: 0.6,
    limitations: "candidate only",
  },
]);

const CTX = {
  programId: "prg_test",
  sanitizedEvidence: [{ id: "evd_1", content: "<UNTRUSTED-DATA>\norder evidence\n</UNTRUSTED-DATA>" }],
};

describe("OpenAI-compatible provider (opt-in real AI)", () => {
  it("parses a clean JSON-array completion", async () => {
    const calls: unknown[] = [];
    const fetchStub = (async (_url: string, init?: RequestInit) => {
      calls.push({ url: _url, init });
      return chatResponse(VALID_HYPOTHESIS_JSON);
    }) as unknown as typeof fetch;
    const provider = new OpenAICompatibleProvider(fetchStub);
    const out = await provider.proposeFromEvidence(CTX);
    expect(out).toHaveLength(1);
    // Request shape: configured endpoint, bearer auth, system prompt, sanitized evidence.
    const init = (calls[0] as { init: RequestInit }).init;
    const body = JSON.parse(init.body as string);
    expect(body.messages[0].content).toBe(SYSTEM_PROMPT);
    expect(body.messages[1].content).toContain("<UNTRUSTED-DATA>");
    expect(body.messages[1].content).toContain("evd_1");
  });

  it("tolerates fenced JSON and object-wrapped arrays", async () => {
    const fenced = "```json\n" + VALID_HYPOTHESIS_JSON + "\n```";
    const p1 = new OpenAICompatibleProvider((async () => chatResponse(fenced)) as unknown as typeof fetch);
    expect(await p1.proposeFromEvidence(CTX)).toHaveLength(1);
    const wrapped = JSON.stringify({ hypotheses: JSON.parse(VALID_HYPOTHESIS_JSON) });
    const p2 = new OpenAICompatibleProvider((async () => chatResponse(wrapped)) as unknown as typeof fetch);
    expect(await p2.proposeFromEvidence(CTX)).toHaveLength(1);
  });

  it("rejects unparseable model output wholesale (schema gate upstream)", async () => {
    const p = new OpenAICompatibleProvider((async () => chatResponse("I cannot answer that in JSON, sorry.")) as unknown as typeof fetch);
    expect(await p.proposeFromEvidence(CTX)).toEqual([]);
  });

  it("fails closed on provider HTTP errors (no hypotheses)", async () => {
    const p = new OpenAICompatibleProvider((async () => jsonResponse({ error: "quota" }, 429)) as unknown as typeof fetch);
    expect(await p.proposeFromEvidence(CTX)).toEqual([]);
  });

  it("keeps the deterministic local critic (unsupported evidence downgrades)", async () => {
    const p = new OpenAICompatibleProvider((async () => chatResponse("[]")) as unknown as typeof fetch);
    const hypothesis = {
      category: "BOLA" as const,
      summary: "x".repeat(20),
      assumptions: ["a"],
      evidence_ids: ["evd_MISSING"],
      risk: "r".repeat(10),
      proposed_validation: "v".repeat(10),
      required_permissions: [],
      expected_outcome: "e",
      alternative_explanations: [],
      confidence: 0.5,
      limitations: "",
    };
    const critique = await p.critique(hypothesis, ["evd_1"]);
    expect(critique?.downgrade).toBe(true);
    expect(critique?.reason).toContain("evd_MISSING");
  });
});
