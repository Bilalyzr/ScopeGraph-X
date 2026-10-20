// Live end-to-end walkthrough of ScopeGraph X module logic over HTTP.
// Runs against an ISOLATED server (port 3100, copy of dev.db) — never the real DB.
const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:3100";
const PW = process.env.E2E_PASSWORD ?? "Demo1234!";
const results = [];
let seq = 0;

function check(name, cond, detail = "") {
  results.push({ ok: !!cond, name, detail });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

async function login(email) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PW }), redirect: "manual",
  });
  const cookies = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const body = await r.json().catch(() => ({}));
  return { status: r.status, cookie: cookies, body };
}

function client(cookie) {
  return async (method, path, body, headers = {}) => {
    const r = await fetch(`${BASE}${path}`, {
      method, redirect: "manual",
      headers: { cookie, ...(body ? { "content-type": "application/json" } : {}), "x-request-id": `e2e-${++seq}`, ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, body: json, headers: r.headers };
  };
}
const code = (res) => `${res.status}${res.body?.code ? " " + res.body.code : res.body?.title ? " " + res.body.title : ""}`;

(async () => {
  const stamp = Date.now().toString(36);
  // ---------------------------------------------------------------- auth
  const anon = client("");
  const unauth = await anon("GET", "/api/v1/programs");
  check("AUTH: unauthenticated API call rejected (401)", unauth.status === 401, code(unauth));
  const bad = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "lead@demo.test", password: "wrong-password" }) });
  check("AUTH: wrong password rejected", bad.status === 401 || bad.status === 400, String(bad.status));

  const roles = {};
  for (const [k, email] of Object.entries({
    lead: "lead@demo.test", owner: "owner@demo.test", researcher: "researcher@demo.test",
    validator: "validator@demo.test", admin: "admin@demo.test", auditor: "auditor@demo.test", globex: "globex@demo.test",
  })) {
    const l = await login(email);
    check(`AUTH: login ${email}`, l.status === 200 && l.cookie.length > 0, `${l.status}${l.body?.mfa_required ? " (MFA required)" : ""}`);
    roles[k] = client(l.cookie);
  }
  const { lead, owner, researcher, validator, admin, auditor, globex } = roles;

  // ------------------------------------------------------------- programs
  const denied = await auditor("POST", "/api/v1/programs", { name: "Auditor attempt", handle: `aud-${stamp}`, authorization_ref: "contract-x" });
  check("RBAC: AUDITOR cannot create programs (403)", denied.status === 403, code(denied));

  const progBody = { name: `E2E Program ${stamp}`, handle: `e2e-${stamp}`, provider: "manual", description: "e2e", authorization_ref: "engagement-e2e-001" };
  const idemKey = `idem-${stamp}`;
  const prog = await lead("POST", "/api/v1/programs", progBody, { "idempotency-key": idemKey });
  check("PROGRAM: APPSEC_LEAD creates program (201)", prog.status === 201 && prog.body?.id, code(prog));
  const programId = prog.body?.id;
  const replay = await lead("POST", "/api/v1/programs", progBody, { "idempotency-key": idemKey });
  check("API: Idempotency-Key replay returns same program", replay.body?.id === programId, `${replay.status} ${replay.body?.id}`);
  const reuse = await lead("POST", "/api/v1/programs", { ...progBody, name: "Different body" }, { "idempotency-key": idemKey });
  check("API: Idempotency-Key reuse with different body rejected (422)", reuse.status === 422, code(reuse));
  const dupHandle = await lead("POST", "/api/v1/programs", progBody);
  check("PROGRAM: duplicate handle rejected (409)", dupHandle.status === 409, code(dupHandle));
  const badProg = await lead("POST", "/api/v1/programs", { name: "x", handle: "BAD HANDLE" });
  check("PROGRAM: invalid payload rejected (422)", badProg.status === 422 || badProg.status === 400, code(badProg));

  // ---------------------------------------------------------------- scope
  const rules = {
    allow: [{ host: "api.e2e-target.test", paths: ["/v1/orders"], methods: ["GET", "POST"] }],
    deny: [{ host: "admin.e2e-target.test", reason: "Excluded by contract" }],
    budgets: { max_requests: 100, max_rps: 2, max_concurrency: 1 }, notes: "e2e",
  };
  const sv1 = await lead("POST", `/api/v1/programs/${programId}/scope-versions`, { rules, note: "v1", provenance: "engagement-e2e-001" });
  check("SCOPE: lead proposes v1 (201, PROPOSED)", sv1.status === 201 && sv1.body?.status === "PROPOSED", code(sv1));
  const sv1Id = sv1.body?.id;
  const badRules = await lead("POST", `/api/v1/programs/${programId}/scope-versions`, { rules: { allow: [], deny: [] } });
  check("SCOPE: empty allow-list rejected (422)", badRules.status === 422, code(badRules));
  const leadApprove = await lead("POST", `/api/v1/scope-versions/${sv1Id}:approve`);
  check("RBAC: APPSEC_LEAD cannot approve scope (403)", leadApprove.status === 403, code(leadApprove));
  const actEarly = await owner("POST", `/api/v1/scope-versions/${sv1Id}:activate`);
  check("SCOPE: activating an unapproved version rejected (409)", actEarly.status === 409, code(actEarly));
  const appr = await owner("POST", `/api/v1/scope-versions/${sv1Id}:approve`);
  check("SCOPE: PROGRAM_OWNER approves v1", appr.status === 200, code(appr));
  const act = await owner("POST", `/api/v1/scope-versions/${sv1Id}:activate`);
  check("SCOPE: owner (not proposer) activates v1", act.status === 200, code(act));

  // Separation of duties: the proposer cannot activate their own version
  const sv2 = await owner("POST", `/api/v1/programs/${programId}/scope-versions`, { rules, note: "v2" });
  await admin("POST", `/api/v1/scope-versions/${sv2.body?.id}:approve`);
  const selfAct = await owner("POST", `/api/v1/scope-versions/${sv2.body?.id}:activate`);
  check("SCOPE: proposer cannot activate own version (separation of duties)", selfAct.status === 403 || selfAct.status === 409, code(selfAct));
  const act2 = await admin("POST", `/api/v1/scope-versions/${sv2.body?.id}:activate`);
  check("SCOPE: independent admin activates v2", act2.status === 200, code(act2));
  const svList = await lead("GET", `/api/v1/programs/${programId}/scope-versions`);
  const statuses = (svList.body?.data ?? []).map((v) => `v${v.version}:${v.status}`).join(",");
  check("SCOPE: v1 SUPERSEDED, v2 ACTIVE", statuses.includes("v1:SUPERSEDED") && statuses.includes("v2:ACTIVE"), statuses);
  const sv2Id = sv2.body?.id;

  // ---------------------------------------------------------------- assets
  const a1 = await researcher("POST", "/api/v1/assets", { program_id: programId, canonical_locator: "api.e2e-target.test", asset_type: "API", note: "in scope" });
  check("ASSET: researcher imports asset (201)", a1.status === 201 || a1.status === 200, code(a1));
  const assetId = a1.body?.id;
  const a2 = await researcher("POST", "/api/v1/assets", { program_id: programId, canonical_locator: "admin.e2e-target.test", asset_type: "HOST" });
  check("ASSET: denied host imported but not AUTHORIZED", a2.body?.scopeState !== "AUTHORIZED", `${a2.status} state=${a2.body?.scopeState}`);
  const assets = await researcher("GET", `/api/v1/assets?program_id=${programId}`);
  check("ASSET: list returns imported assets", JSON.stringify(assets.body).includes("api.e2e-target.test"), String(assets.status));

  // ------------------------------------------------------------ identities
  const idBad = await researcher("POST", "/api/v1/identities", { program_id: programId, role_label: "support", secret_ref: "plaintext-password" });
  check("IDENTITY: non-vault secret rejected (422)", idBad.status === 422, code(idBad));
  const id1 = await researcher("POST", "/api/v1/identities", { program_id: programId, role_label: "support-agent", tenant_label: "tenant-a", secret_ref: "vault://e2e/support" });
  const id2 = await researcher("POST", "/api/v1/identities", { program_id: programId, role_label: "billing-admin", tenant_label: "tenant-b", secret_ref: "vault://e2e/billing" });
  check("IDENTITY: vault-referenced identities created", [200, 201].includes(id1.status) && [200, 201].includes(id2.status), `${id1.status}/${id2.status}`);
  check("IDENTITY: only vault references stored (no raw secret field)", !JSON.stringify(id1.body).match(/"(password|token|secret)"\s*:/i), "");

  // ------------------------------------------------------------- campaigns
  const stale = await researcher("POST", "/api/v1/campaigns", { program_id: programId, policy_version_id: sv1Id, name: "Stale policy", mode: "PASSIVE_ONLY", budget: rules.budgets });
  check("CAMPAIGN: superseded policy version rejected (409)", stale.status === 409, code(stale));
  const camp = await researcher("POST", "/api/v1/campaigns", { program_id: programId, policy_version_id: sv2Id, name: `Passive ${stamp}`, mode: "PASSIVE_ONLY", budget: rules.budgets, asset_ids: assetId ? [assetId] : [] });
  check("CAMPAIGN: create against ACTIVE policy (201)", camp.status === 201, code(camp) + (camp.status !== 201 ? " " + JSON.stringify(camp.body).slice(0, 200) : ""));
  const campId = camp.body?.id;
  const start = await researcher("POST", `/api/v1/campaigns/${campId}:start`);
  check("CAMPAIGN: start", start.status === 200 || start.status === 202, code(start));
  const again = await researcher("POST", `/api/v1/campaigns/${campId}:start`);
  check("CAMPAIGN: double start rejected (409)", again.status === 409, code(again));
  const drain = await researcher("POST", "/api/v1/jobs");
  check("JOBS: queue drains", drain.status === 200, JSON.stringify(drain.body));
  const jobs = await researcher("GET", `/api/v1/jobs?campaign_id=${campId}`);
  const jobRows = jobs.body?.data ?? [];
  const jobSummary = jobRows.map((j) => `${j.kind}:${j.status}`).join(", ");
  check("JOBS: campaign jobs finished (no FAILED)", jobRows.length > 0 && jobRows.every((j) => j.status !== "FAILED" && j.status !== "QUEUED"), jobSummary || JSON.stringify(jobs.body).slice(0, 200));
  const campList = await researcher("GET", `/api/v1/campaigns?program_id=${programId}`);
  const cRow = (campList.body?.data ?? []).find((c) => c.id === campId);
  check("CAMPAIGN: completes after jobs drain", cRow?.state === "COMPLETED", `state=${cRow?.state}`);
  const afterAssets = await researcher("GET", `/api/v1/assets?program_id=${programId}`);
  const afterFindings = await researcher("GET", `/api/v1/findings?program_id=${programId}`);
  const fabricated = /demo-target|DEMO fixture/i.test(JSON.stringify(afterAssets.body) + JSON.stringify(afterFindings.body));
  check("DATA: campaign run fabricates no mock assets/findings", !fabricated, fabricated ? "demo/mock data detected" : "");

  // -------------------------------------------------------------- findings
  const fBody = {
    program_id: programId, asset_id: assetId, category: "BOLA", title: `E2E cross-tenant order read ${stamp}`,
    description: "Support agent identity can read another tenant's order record.", severity: "HIGH", confidence: 0.6,
    expected_behavior: "403", observed_behavior: "200 with data", reproduction_steps: ["login as support", "GET /v1/orders/1"],
  };
  const f = await researcher("POST", "/api/v1/findings", fBody);
  check("FINDING: researcher files candidate (201, PROPOSED)", f.status === 201 && f.body?.status === "PROPOSED", code(f));
  const fid = f.body?.id;
  const dupF = await researcher("POST", "/api/v1/findings", fBody);
  check("FINDING: duplicate fingerprint rejected (409)", dupF.status === 409, code(dupF));
  const fx = await researcher("POST", "/api/v1/findings", { ...fBody, asset_id: "ast_does_not_exist", title: `Bad asset ref ${stamp}` });
  check("FINDING: foreign/unknown asset_id rejected (422)", fx.status === 422, code(fx));

  const T = (who, to, reason = "e2e") => who("POST", `/api/v1/findings/${fid}:review`, { to, reason });
  const rObs = await T(researcher, "OBSERVED");
  check("LIFECYCLE: RESEARCHER can mark OBSERVED (allowed by lifecycle role table)", rObs.status === 200, code(rObs));
  if (rObs.status !== 200) { const l = await T(lead, "OBSERVED"); check("LIFECYCLE: lead marks OBSERVED", l.status === 200, code(l)); }
  const skip = await T(validator, "REPORTED");
  check("LIFECYCLE: skipping states rejected (422)", skip.status === 422, code(skip));
  const rep = await T(validator, "REPRODUCED");
  check("LIFECYCLE: validator → REPRODUCED", rep.status === 200, code(rep));
  const rev = await T(validator, "REVIEWED");
  check("LIFECYCLE: validator → REVIEWED", rev.status === 200, code(rev));
  const early = await T(validator, "REPORTED");
  check("LIFECYCLE: REPORTED blocked until independent validation (422)", early.status === 422, code(early));
  const resVal = await researcher("POST", `/api/v1/findings/${fid}:validate`, { outcome: "VALIDATED", notes: "self" });
  check("RBAC: researcher cannot validate own finding (403)", resVal.status === 403, code(resVal));
  const val = await validator("POST", `/api/v1/findings/${fid}:validate`, { outcome: "VALIDATED", notes: "Independently reproduced with fixture identities" });
  check("LIFECYCLE: validator records VALIDATED", val.status === 200, code(val));
  const repd = await T(validator, "REPORTED");
  check("LIFECYCLE: → REPORTED after validation", repd.status === 200, code(repd));
  const oAcc = await T(owner, "ACCEPTED");
  check("LIFECYCLE: PROGRAM_OWNER can ACCEPT (allowed by lifecycle role table)", oAcc.status === 200, code(oAcc));
  if (oAcc.status !== 200) { const a = await T(admin, "ACCEPTED"); check("LIFECYCLE: admin → ACCEPTED", a.status === 200, code(a)); }
  const cl = await T(admin, "CLOSED");
  check("LIFECYCLE: → CLOSED", cl.status === 200, code(cl));
  const reopen = await T(admin, "OBSERVED");
  check("LIFECYCLE: CLOSED is terminal (422)", reopen.status === 422, code(reopen));

  // ---------------------------------------------------------------- reports
  const f2 = await researcher("POST", "/api/v1/findings", { ...fBody, title: `Unreviewed candidate ${stamp}`, category: "IDOR" });
  const pdfBlocked = await researcher("POST", "/api/v1/reports", { program_id: programId, format: "pdf" });
  check("REPORT: PDF blocked while PROPOSED findings exist (409)", pdfBlocked.status === 409, code(pdfBlocked));
  const json = await researcher("POST", "/api/v1/reports", { program_id: programId, format: "json" });
  check("REPORT: JSON export allowed", json.status === 200, code(json));
  await validator("POST", `/api/v1/findings/${f2.body?.id}:review`, { to: "FALSE_POSITIVE", reason: "e2e" });
  const pdf = await researcher("POST", "/api/v1/reports", { program_id: programId, format: "pdf" });
  check("REPORT: PDF generated once reviewed", pdf.status === 200 && String(pdf.headers.get("content-type")).includes("pdf"), `${pdf.status} ${pdf.headers.get("content-type")}`);
  const html = await researcher("POST", "/api/v1/reports", { program_id: programId, format: "html" });
  check("REPORT: HTML generated", html.status === 200, code(html));

  // --------------------------------------------------- hypotheses + tests
  const hyps = await researcher("GET", `/api/v1/hypotheses?program_id=${programId}`);
  const hyp = (hyps.body?.data ?? [])[0];
  check("AI: hypotheses endpoint responds", hyps.status === 200, `${hyps.status} count=${(hyps.body?.data ?? []).length}`);
  if (hyp) {
    const out = await researcher("POST", `/api/v1/hypotheses/${hyp.id}/tests`, { target_host: "admin.e2e-target.test", target_path: "/v1/orders", identities: [id1.body?.id] });
    const tIn = await researcher("POST", `/api/v1/hypotheses/${hyp.id}/tests`, { target_host: "api.e2e-target.test", target_path: "/v1/orders/1", identities: [id1.body?.id, id2.body?.id] });
    check("TEST: researcher proposes test plan", [200, 201].includes(tIn.status), code(tIn));
    const self = await lead("POST", `/api/v1/tests/${tIn.body?.id}:approve`, { decision: "APPROVE" });
    check("TEST: approval by different principal allowed", self.status === 200, code(self));
    if ([200, 201].includes(out.status)) {
      const oa = await validator("POST", `/api/v1/tests/${out.body?.id}:approve`, { decision: "APPROVE" });
      check("TEST: out-of-scope test cannot be approved (403)", oa.status === 403, code(oa));
    } else check("TEST: out-of-scope test rejected at proposal", out.status >= 400, code(out));
  }

  // ------------------------------------------------------- emergency stop
  const rStop = await researcher("POST", "/api/v1/emergency-stop", { scope: "ORG", reason: "researcher attempt" });
  check("RBAC: researcher cannot engage emergency stop (403)", rStop.status === 403, code(rStop));
  const stop = await owner("POST", "/api/v1/emergency-stop", { scope: "ORG", reason: "E2E drill" });
  check("STOP: owner engages org-wide emergency stop", [200, 201].includes(stop.status), code(stop));
  const stopId = stop.body?.id ?? stop.body?.stop?.id;
  const c2 = await researcher("POST", "/api/v1/campaigns", { program_id: programId, policy_version_id: sv2Id, name: `During stop ${stamp}`, mode: "PASSIVE_ONLY", budget: rules.budgets });
  const c2Start = c2.body?.id ? await researcher("POST", `/api/v1/campaigns/${c2.body.id}:start`) : c2;
  check("STOP: campaigns cannot start while stop active", c2Start.status >= 400, code(c2Start));
  const gStop = await globex("GET", "/api/v1/emergency-stop");
  const gStopActive = JSON.stringify(gStop.body).includes("E2E drill");
  check("TENANCY: other tenant does not see this org's stop", !gStopActive, `${gStop.status}`);
  const rel = await owner("DELETE", `/api/v1/emergency-stop?id=${stopId}`);
  check("STOP: owner releases stop", rel.status === 200 || rel.status === 204, code(rel));
  if (c2.body?.id) {
    const after = await researcher("POST", `/api/v1/campaigns/${c2.body.id}:start`);
    check("STOP: campaign can start after release", after.status === 200 || after.status === 202, code(after));
  }

  // ------------------------------------------------------- policy revoke
  const rv = await owner("POST", `/api/v1/scope-versions/${sv2Id}:revoke`, { reason: "Contract ended (e2e)" });
  check("SCOPE: owner revokes active policy", rv.status === 200, code(rv));
  const c3 = await researcher("POST", "/api/v1/campaigns", { program_id: programId, policy_version_id: sv2Id, name: `After revoke ${stamp}`, mode: "PASSIVE_ONLY", budget: rules.budgets });
  check("SCOPE: campaigns against revoked policy rejected (409)", c3.status === 409, code(c3));

  // ---------------------------------------------------------------- tenancy
  const gProg = await globex("GET", `/api/v1/programs/${programId}`);
  check("TENANCY: other tenant cannot read program (404)", gProg.status === 404 || gProg.status === 403, code(gProg));
  const gF = await globex("GET", "/api/v1/findings");
  check("TENANCY: other tenant's findings list excludes ours", !JSON.stringify(gF.body).includes(stamp), String(gF.status));
  const gReview = await globex("POST", `/api/v1/findings/${fid}:review`, { to: "REJECTED" });
  check("TENANCY: other tenant cannot transition our finding", gReview.status === 404 || gReview.status === 403, code(gReview));
  const gAsset = await globex("POST", "/api/v1/assets", { program_id: programId, canonical_locator: "evil.test" });
  check("TENANCY: other tenant cannot attach assets to our program", gAsset.status === 404 || gAsset.status === 403, code(gAsset));

  // ------------------------------------------------------------ audit + webhooks
  const aud = await auditor("GET", "/api/v1/audit-events?limit=50");
  const actions = new Set((aud.body?.data ?? []).map((e) => e.action));
  check("AUDIT: auditor reads ledger", aud.status === 200 && actions.size > 0, [...actions].slice(0, 8).join(","));
  const resAud = await researcher("GET", "/api/v1/audit-events");
  check("RBAC: researcher cannot read audit ledger (403)", resAud.status === 403, code(resAud));
  const csv = await auditor("GET", "/api/v1/audit-events/export");
  check("AUDIT: CSV export", csv.status === 200 && String(csv.headers.get("content-type")).includes("csv"), `${csv.status} ${csv.headers.get("content-type")}`);
  const ssrf = await admin("POST", "/api/v1/webhooks", { url: "http://127.0.0.1:8080/hook", events: ["finding.status_changed"] });
  check("WEBHOOK: private/loopback URL rejected (SSRF guard)", ssrf.status >= 400 && ssrf.status < 500, code(ssrf));
  const wh = await admin("POST", "/api/v1/webhooks", { url: "https://hooks.example.com/sgx", events: ["finding.status_changed"] });
  check("WEBHOOK: public HTTPS endpoint registered", [200, 201].includes(wh.status), code(wh));
  const whSecretLeak = wh.body && JSON.stringify(wh.body);
  const whList = await admin("GET", "/api/v1/webhooks");
  check("WEBHOOK: list does not expose sealed secret", whList.status === 200 && !/"secret":"(?!\*)/.test(JSON.stringify(whList.body)), String(whList.status));
  void whSecretLeak;

  // ---------------------------------------------------------------- pages
  for (const p of ["/", "/login", "/dashboard", "/programs", `/programs/${programId}`, "/assets", "/campaigns", "/findings", `/findings/${fid}`, "/research", "/graph", "/reports", "/audit", "/settings", "/admin"]) {
    const r = await admin("GET", p);
    check(`PAGE: ${p} renders`, r.status === 200, String(r.status));
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n==== ${results.length - failed.length}/${results.length} checks passed ====`);
  for (const f of failed) console.log(`FAILED: ${f.name} — ${f.detail}`);
})().catch((e) => { console.error("E2E crashed:", e); process.exit(2); });
