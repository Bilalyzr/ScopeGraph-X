import { describe, expect, it } from "vitest";
import { canTransition, roleCanSetStatus, fingerprintOf } from "@/lib/findings/lifecycle";

describe("finding lifecycle (FR-FND-01: transitions permission-checked)", () => {
  it("follows the documented happy path", () => {
    for (const [from, to] of [
      ["PROPOSED", "OBSERVED"], ["OBSERVED", "REPRODUCED"], ["REPRODUCED", "REVIEWED"],
      ["REVIEWED", "REPORTED"], ["REPORTED", "ACCEPTED"], ["ACCEPTED", "CLOSED"],
    ] as const) {
      expect(canTransition(from, to), `${from}→${to}`).toBe(true);
    }
  });

  it("rejects skips and illegal jumps", () => {
    expect(canTransition("PROPOSED", "REVIEWED")).toBe(false); // must pass OBSERVED/REPRODUCED
    expect(canTransition("PROPOSED", "REPORTED")).toBe(false);
    expect(canTransition("CLOSED", "PROPOSED")).toBe(false); // terminal
    expect(canTransition("REJECTED", "OBSERVED")).toBe(false); // terminal
  });

  it("allows rejection/false-positive exits from candidate states", () => {
    expect(canTransition("OBSERVED", "FALSE_POSITIVE")).toBe(true);
    expect(canTransition("OBSERVED", "DUPLICATE")).toBe(true);
  });

  it("gates transitions by role", () => {
    expect(roleCanSetStatus("RESEARCHER", "REPRODUCED")).toBe(false); // independent reproduction
    expect(roleCanSetStatus("VALIDATOR", "REPRODUCED")).toBe(true);
    expect(roleCanSetStatus("RESEARCHER", "ACCEPTED")).toBe(false); // program owner decision
    expect(roleCanSetStatus("PROGRAM_OWNER", "ACCEPTED")).toBe(true);
    expect(roleCanSetStatus("AUDITOR", "CLOSED")).toBe(false); // read-only role
  });

  it("fingerprints deterministically and separates assets", () => {
    const base = { programId: "prg", category: "BOLA", title: "Same Title" };
    expect(fingerprintOf(base)).toBe(fingerprintOf({ ...base, title: "same title" }));
    expect(fingerprintOf(base)).not.toBe(fingerprintOf({ ...base, assetId: "ast2" }));
  });
});
