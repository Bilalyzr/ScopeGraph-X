import { db } from "@/lib/db";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { parseRules, type ScopeRules } from "./rules";
import { matchScope } from "./matcher";
import { classifyIp, isBlockedAddress, isValidHostname, simulatedResolve } from "./ipguard";

// SECURITY POLICY GATEWAY — the mandatory authorization boundary for all
// active outbound operations (PRD §6). The scheduler may request a job; only
// this module authorizes an outbound operation. Every check fails closed.
//
// EGRESS IS ALWAYS SIMULATED IN THIS BUILD: the gateway decides and logs; the
// dev executor performs no real network I/O (see docs/security-model.md).

export type EgressDecision = "ALLOW" | "DENY";

export interface EgressRequest {
  orgId: string;
  programId: string;
  campaignId?: string;
  jobRef: string;
  host: string;
  path: string;
  method: string;
  approvalRef?: string;
}

export interface EgressResult {
  decision: EgressDecision;
  reason: string;
  code?: string;
  resolvedIp?: string;
  policyVersionId?: string;
  simulated: true;
}

interface RateState {
  windowStart: number;
  count: number;
}

const rateState = new Map<string, RateState>();
const concurrency = new Map<string, number>();

export async function activeScopeVersion(programId: string) {
  return db.scopeVersion.findFirst({
    where: { programId, status: "ACTIVE" },
    orderBy: { version: "desc" },
  });
}

export async function emergencyStopActive(orgId: string, programId: string): Promise<string | null> {
  const stops = await db.emergencyStop.findMany({
    where: {
      active: true,
      OR: [
        { scope: "GLOBAL" },
        { scope: "ORG", orgId },
        { scope: "PROGRAM", programId, orgId },
      ],
    },
  });
  if (stops.length === 0) return null;
  return stops[0].id;
}

/** Count of already-authorized requests for a campaign (durable budget source). */
async function campaignRequestCount(campaignId: string): Promise<number> {
  return db.egressCheck.count({ where: { campaignId, decision: "ALLOW" } });
}

export async function authorizeEgress(req: EgressRequest): Promise<EgressResult> {
  const deny = async (reason: string, code: string): Promise<EgressResult> => {
    await db.egressCheck.create({
      data: {
        id: newId("egc"),
        orgId: req.orgId,
        campaignId: req.campaignId,
        jobRef: req.jobRef,
        destination: `${req.method} ${req.host}${req.path}`,
        method: req.method,
        decision: "DENY",
        reason,
        simulated: true,
      },
    });
    await audit({
      orgId: req.orgId,
      actorType: "SERVICE",
      actorId: "policy-gateway",
      action: "egress.denied",
      resourceType: "EgressRequest",
      resourceId: req.jobRef,
      decision: "DENY",
      reason,
      metadata: { code, host: req.host, path: req.path },
    });
    return { decision: "DENY", reason, code, simulated: true };
  };

  // 1. Emergency stop — checked first, overrides everything.
  const stop = await emergencyStopActive(req.orgId, req.programId);
  if (stop) return deny("Emergency stop is active", "EMERGENCY_STOP");

  // 2. Program must exist, belong to this tenant, and be ACTIVE.
  const program = await db.program.findFirst({ where: { id: req.programId, orgId: req.orgId } });
  if (!program) return deny("Program not found in tenant", "NO_PROGRAM");
  if (program.state !== "ACTIVE") return deny(`Program state is ${program.state}`, "PROGRAM_NOT_ACTIVE");

  // 3. An approved+activated policy version must exist; revoked => fail closed (409 semantics).
  const policy = await activeScopeVersion(req.programId);
  if (!policy) return deny("No active policy version", "NO_ACTIVE_POLICY");

  // 4. Campaign binding: campaign must be RUNNING and pinned to this exact policy version.
  let campaignBudget: { max_requests?: number; max_rps?: number; max_concurrency?: number } | null = null;
  if (req.campaignId) {
    const campaign = await db.campaign.findFirst({
      where: { id: req.campaignId, programId: req.programId, orgId: req.orgId },
    });
    if (!campaign) return deny("Campaign not found for program", "NO_CAMPAIGN");
    if (campaign.state !== "RUNNING") return deny(`Campaign state is ${campaign.state}`, "CAMPAIGN_NOT_RUNNING");
    if (campaign.policyVersionId !== policy.id) {
      return deny("Campaign references a superseded policy version", "POLICY_REVOKED");
    }
    try {
      campaignBudget = JSON.parse(campaign.budgetJson);
    } catch {
      campaignBudget = null;
    }
  }

  // 5. Active operations require the host to be an AUTHORIZED asset of this program.
  const asset = await db.asset.findFirst({
    where: { programId: req.programId, orgId: req.orgId, canonicalLocator: hostKey(req.host) },
  });
  if (!asset) return deny("Host is not a registered asset of this program", "ASSET_NOT_IN_PROGRAM");
  if (asset.scopeState !== "AUTHORIZED") {
    return deny(`Asset scope state is ${asset.scopeState}; active testing requires AUTHORIZED`, "ASSET_NOT_AUTHORIZED");
  }

  // 6. Hostname syntax must be valid before resolution.
  if (!isValidHostname(req.host)) return deny("Malformed hostname", "INVALID_HOST");

  // 7. Resolve and validate destination addresses at the enforcement point.
  const ips = simulatedResolve(req.host);
  if (ips.length === 0) return deny("Host did not resolve in the simulated resolver", "UNRESOLVABLE_HOST");
  const blocked = ips.find((ip) => isBlockedAddress(ip));
  if (blocked) return deny(`Resolved address ${blocked} is ${classifyIp(blocked)} and blocked by default`, "SSRF_GUARD");
  const resolvedIp = ips[0];

  // 8. Deny-priority scope matching on host/path/method.
  const rules: ScopeRules = parseRules(policy.rulesJson);
  const match = matchScope(rules, { host: req.host, path: req.path, method: req.method });
  if (!match.allowed) {
    return deny(match.matchedDeny ? `Deny rule: ${match.matchedDeny.reason}` : "No allow rule matches", "OUT_OF_SCOPE");
  }

  // 9. Durable request budget (enforces tighter of policy budget and campaign budget).
  if (req.campaignId) {
    const maxRequests = Math.min(rules.budgets.max_requests, campaignBudget?.max_requests ?? rules.budgets.max_requests);
    const maxRps = Math.min(rules.budgets.max_rps, campaignBudget?.max_rps ?? rules.budgets.max_rps);
    const maxConcurrency = Math.min(rules.budgets.max_concurrency, campaignBudget?.max_concurrency ?? rules.budgets.max_concurrency);

    const used = await campaignRequestCount(req.campaignId);
    if (used >= maxRequests) {
      return deny(`Request budget exhausted (${used}/${maxRequests})`, "BUDGET_EXHAUSTED");
    }
    // In-process rate limit (single-node dev; Redis-backed in production).
    const now = Date.now();
    const st = rateState.get(req.campaignId) ?? { windowStart: now, count: 0 };
    if (now - st.windowStart >= 1000) {
      st.windowStart = now;
      st.count = 0;
    }
    if (st.count >= maxRps) return deny(`Rate limit ${maxRps} rps exceeded`, "RATE_LIMIT");
    const conc = concurrency.get(req.campaignId) ?? 0;
    if (conc >= maxConcurrency) return deny(`Concurrency limit ${maxConcurrency} exceeded`, "CONCURRENCY_LIMIT");
    st.count += 1;
    rateState.set(req.campaignId, st);
  }

  await db.egressCheck.create({
    data: {
      id: newId("egc"),
      orgId: req.orgId,
      campaignId: req.campaignId,
      jobRef: req.jobRef,
      destination: `${req.method} ${req.host}${req.path}`,
      method: req.method,
      decision: "ALLOW",
      reason: "Authorized by active policy",
      simulated: true,
    },
  });
  return { decision: "ALLOW", reason: "Authorized", resolvedIp, policyVersionId: policy.id, simulated: true };
}

/**
 * Egress-point revalidation (defense against DNS rebinding / TOCTOU): the
 * executor must confirm the address it is about to use still resolves to the
 * authorized IP. Any mismatch fails closed.
 */
export async function revalidateConnection(host: string, authorizedIp: string): Promise<EgressResult> {
  const ips = simulatedResolve(host);
  if (!ips.includes(authorizedIp)) {
    return {
      decision: "DENY",
      reason: `DNS answer changed at egress point (${authorizedIp} -> ${ips.join(", ") || "none"}); possible rebinding`,
      code: "REBINDING_SUSPECTED",
      simulated: true,
    };
  }
  return { decision: "ALLOW", reason: "Address stable", resolvedIp: authorizedIp, simulated: true };
}

function hostKey(host: string): string {
  return host.trim().toLowerCase();
}

export function acquireConcurrencySlot(campaignId: string, max: number): boolean {
  const cur = concurrency.get(campaignId) ?? 0;
  if (cur >= max) return false;
  concurrency.set(campaignId, cur + 1);
  return true;
}

export function releaseConcurrencySlot(campaignId: string): void {
  const cur = concurrency.get(campaignId) ?? 0;
  concurrency.set(campaignId, Math.max(0, cur - 1));
}

export function resetRuntimeBudgets(): void {
  rateState.clear();
  concurrency.clear();
}
