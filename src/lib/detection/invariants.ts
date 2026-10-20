import { db } from "@/lib/db";
import { newId } from "@/lib/ids";
import { storeEvidence } from "@/lib/evidence/store";
import { createFinding } from "@/lib/findings/lifecycle";

// Stateful business-workflow invariant engine (FR-DET-03): analyst-approved
// declarative state machines on disposable fixtures. The engine replays
// recorded transitions against the approved machine and flags:
//   1. ILLEGAL_TRANSITION — a transition not present in the approved graph
//   2. NON_IDEMPOTENT_OPERATION — a state-changing op marked idempotent that
//      produced different outcomes on identical replay inputs
// Findings stay candidates; non-idempotent probes require explicit approval
// by design (they only ever run against fixture records here).

export interface StateMachine {
  initialState: string;
  terminalStates: string[];
  /** Approved transitions: from -> to, with guard roles if any. */
  transitions: Array<{ from: string; to: string; guard?: string }>;
  /** Operations that MUST be idempotent per the business contract. */
  idempotentOperations?: string[];
}

export interface RecordedTransition {
  operation: string;
  from: string;
  to: string;
  /** Outcome digest on first execution and on identical replay, if recorded. */
  firstOutcome?: string;
  replayOutcome?: string;
}

export interface InvariantViolation {
  kind: "ILLEGAL_TRANSITION" | "NON_IDEMPOTENT_OPERATION";
  operation: string;
  from: string;
  to: string;
  detail: string;
}

export function validateMachine(machine: StateMachine): string[] {
  const errors: string[] = [];
  const states = new Set<string>([machine.initialState, ...machine.terminalStates, ...machine.transitions.flatMap((t) => [t.from, t.to])]);
  if (!states.has(machine.initialState)) errors.push("initialState not present in transition graph");
  if (machine.terminalStates.length === 0) errors.push("at least one terminal state required");
  for (const t of machine.transitions) {
    if (t.from === t.to) errors.push(`self-transition ${t.from}→${t.to} is suspicious`);
  }
  return errors;
}

export function checkInvariants(
  machine: StateMachine,
  recorded: RecordedTransition[]
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const approved = new Set(machine.transitions.map((t) => `${t.from}→${t.to}`));
  let current = machine.initialState;

  for (const r of recorded) {
    if (r.from !== current) {
      violations.push({
        kind: "ILLEGAL_TRANSITION",
        operation: r.operation,
        from: r.from,
        to: r.to,
        detail: `Recorded 'from' state ${r.from} does not match expected current state ${current} (possible skipped/hidden transition)`,
      });
    }
    if (!approved.has(`${r.from}→${r.to}`)) {
      violations.push({
        kind: "ILLEGAL_TRANSITION",
        operation: r.operation,
        from: r.from,
        to: r.to,
        detail: `Transition ${r.from}→${r.to} is not in the analyst-approved state machine`,
      });
    }
    const idem = machine.idempotentOperations?.includes(r.operation);
    if (idem && r.firstOutcome !== undefined && r.replayOutcome !== undefined && r.firstOutcome !== r.replayOutcome) {
      violations.push({
        kind: "NON_IDEMPOTENT_OPERATION",
        operation: r.operation,
        from: r.from,
        to: r.to,
        detail: `Operation marked idempotent produced different outcomes (${r.firstOutcome} vs ${r.replayOutcome}) on identical replay`,
      });
    }
    current = r.to;
  }
  return violations;
}

/** Run the engine over a persisted Resource and materialize results + findings. */
export async function runInvariantCheck(resourceId: string, actorId: string) {
  const resource = await db.resource.findUnique({ where: { id: resourceId } });
  if (!resource) throw new Error("RESOURCE_NOT_FOUND");
  const program = await db.program.findUnique({ where: { id: resource.programId } });
  if (!program) throw new Error("PROGRAM_NOT_FOUND");
  const machine = JSON.parse(resource.invariantJson || "{}") as StateMachine & { recorded?: RecordedTransition[] };
  if (!machine.transitions) throw new Error("NO_INVARIANT_DEFINED");

  const violations = checkInvariants(machine, machine.recorded ?? []);
  const status = violations.length > 0 ? "VIOLATIONS_FOUND" : "COMPLETED";

  const { evidence } = await storeEvidence({
    orgId: program.orgId,
    createdBy: actorId,
    source: "invariant-engine",
    content: {
      resource: resourceId,
      fixture: resource.fixtureRef,
      machine: { initialState: machine.initialState, terminalStates: machine.terminalStates, transitions: machine.transitions },
      recorded: machine.recorded ?? [],
      violations,
      note: "Executed against disposable fixture records only (simulated).",
    },
  });

  const run = await db.invariantRun.create({
    data: {
      id: newId("inv"),
      orgId: program.orgId,
      programId: program.id,
      resourceId,
      status,
      transitionsJson: JSON.stringify(machine.recorded ?? []),
      violationsJson: JSON.stringify(violations),
      evidenceId: evidence.id,
    },
  });

  let findingId: string | undefined;
  if (violations.length > 0) {
    try {
      const asset = await db.asset.findFirst({ where: { programId: resource.programId } });
      const f = await createFinding({
        orgId: program.orgId,
        programId: resource.programId,
        assetId: asset?.id,
        category: "WORKFLOW_VIOLATION",
        title: `Business workflow invariant violated on ${resource.objectType} fixture (DEMO)`,
        description: `Invariant engine flagged ${violations.length} violation(s) against the analyst-approved state machine: ${violations.map((v) => v.detail).join(" | ")}. Candidate only — independent validation required.`,
        severity: "HIGH",
        confidence: 0.65,
        expectedBehavior: "Recorded transitions conform to the approved state machine",
        observedBehavior: violations.map((v) => `${v.kind}: ${v.operation} ${v.from}→${v.to}`).join("; "),
        impact: "Potential business-logic bypass (e.g., skipping approval or payment states)",
        limitations: "Derived from fixture replay; reproduce in staging with approved test plan",
        remediation: "Enforce server-side state transition validation",
        reproductionSteps: ["Review invariant run evidence", "Replay transitions against staging fixture with approved test"],
        evidenceRefs: [{ evidenceId: evidence.id, role: "primary" }],
        actorId,
        sourceDetector: "invariant-engine",
      });
      findingId = f.id;
    } catch {
      // duplicate finding — already tracked
    }
  }

  return { run, violations, findingId };
}
