"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface AllowRow { host: string; paths: string; methods: string[] }
interface DenyRow { host: string; reason: string }

const DEFAULT_ALLOW: AllowRow[] = [
  { host: "shop.demo-target.test", paths: "/", methods: ["GET"] },
  { host: "api.demo-target.test", paths: "/v1/orders, /v1/users", methods: ["GET", "POST"] },
];
const DEFAULT_DENY: DenyRow[] = [{ host: "admin.demo-target.test", reason: "Excluded by program policy" }];
const ALL_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

function splitPaths(paths: string): string[] {
  const list = paths.split(",").map((p) => p.trim()).filter(Boolean);
  return list.length ? list : ["/"];
}

function buildRules(
  allow: AllowRow[],
  deny: DenyRow[],
  budgets: { max_requests: number; max_rps: number; max_concurrency: number },
  notes: string
) {
  return {
    allow: allow
      .filter((a) => a.host.trim())
      .map((a) => ({
        host: a.host.trim(),
        paths: splitPaths(a.paths),
        methods: a.methods.length ? a.methods : ["GET"],
      })),
    deny: deny.filter((d) => d.host.trim()).map((d) => ({ host: d.host.trim(), reason: d.reason.trim() || "Excluded" })),
    budgets,
    notes,
  };
}

/** Scope policy compiler — structured builder by default, JSON mode kept. */
export function ProposeScopeForm({ programId }: { programId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"builder" | "json">("builder");
  const [allow, setAllow] = useState<AllowRow[]>(DEFAULT_ALLOW.map((a) => ({ ...a, methods: [...a.methods] })));
  const [deny, setDeny] = useState<DenyRow[]>(DEFAULT_DENY.map((d) => ({ ...d })));
  const [budgets, setBudgets] = useState({ max_requests: 500, max_rps: 2, max_concurrency: 2 });
  const [notes, setNotes] = useState("");
  const [json, setJson] = useState(
    JSON.stringify(buildRules(DEFAULT_ALLOW, DEFAULT_DENY, { max_requests: 500, max_rps: 2, max_concurrency: 2 }, ""), null, 2)
  );
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let rules: unknown;
      if (mode === "builder") {
        rules = buildRules(allow, deny, budgets, notes);
        setJson(JSON.stringify(rules, null, 2)); // keep the JSON view in sync
      } else {
        rules = JSON.parse(json);
      }
      const res = await fetch(`/api/v1/programs/${programId}/scope-versions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rules, note: note || "Proposed from scope builder", provenance: "ui-scope-builder" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(`${data.code}: ${data.detail ?? data.title}`);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div>
        <h2>Scope policy compiler</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          Draft a new versioned allow/deny/budget rule set. Requires separate human approval before activation.
        </p>
        <button className="btn primary" onClick={() => setOpen(true)}>+ Propose scope version</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <div className="row spread">
        <h2 style={{ margin: 0 }}>Propose new scope version</h2>
        <div className="row">
          <button type="button" className={`btn small ${mode === "builder" ? "primary" : ""}`} onClick={() => setMode("builder")}>Builder</button>
          <button type="button" className={`btn small ${mode === "json" ? "primary" : ""}`} onClick={() => setMode("json")}>JSON</button>
        </div>
      </div>

      {mode === "builder" ? (
        <>
          <h3 style={{ fontSize: "0.8rem", margin: "0.9rem 0 0.4rem", color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Allow rules — what policy-gated testing may touch
          </h3>
          {allow.map((a, i) => (
            <div className="row" key={i} style={{ alignItems: "flex-end", marginBottom: "0.4rem" }}>
              <label className="field" style={{ flex: 2, margin: 0 }}>Host
                <input value={a.host} onChange={(e) => setAllow(allow.map((r, j) => (j === i ? { ...r, host: e.target.value } : r)))} placeholder="api.example.com" />
              </label>
              <label className="field" style={{ flex: 2, margin: 0 }}>Paths (comma-sep prefixes)
                <input value={a.paths} onChange={(e) => setAllow(allow.map((r, j) => (j === i ? { ...r, paths: e.target.value } : r)))} placeholder="/, /v1/orders" />
              </label>
              <label className="field" style={{ flex: 1.4, margin: 0 }}>Methods (ctrl-click)
                <select
                  multiple
                  value={a.methods}
                  onChange={(e) => setAllow(allow.map((r, j) => (j === i ? { ...r, methods: [...e.target.selectedOptions].map((o) => o.value) } : r)))}
                  style={{ height: 64 }}
                  aria-label={`Methods for allow rule ${i + 1}`}
                >
                  {ALL_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <button type="button" className="btn small danger" aria-label={`Remove allow rule ${i + 1}`} onClick={() => setAllow(allow.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <button type="button" className="btn small" onClick={() => setAllow([...allow, { host: "", paths: "/", methods: ["GET"] }])}>+ Add allow rule</button>

          <h3 style={{ fontSize: "0.8rem", margin: "0.9rem 0 0.4rem", color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Deny rules — always override allows
          </h3>
          {deny.map((d, i) => (
            <div className="row" key={i} style={{ alignItems: "flex-end", marginBottom: "0.4rem" }}>
              <label className="field" style={{ flex: 2, margin: 0 }}>Host
                <input value={d.host} onChange={(e) => setDeny(deny.map((r, j) => (j === i ? { ...r, host: e.target.value } : r)))} placeholder="admin.example.com" />
              </label>
              <label className="field" style={{ flex: 3, margin: 0 }}>Reason
                <input value={d.reason} onChange={(e) => setDeny(deny.map((r, j) => (j === i ? { ...r, reason: e.target.value } : r)))} />
              </label>
              <button type="button" className="btn small danger" aria-label={`Remove deny rule ${i + 1}`} onClick={() => setDeny(deny.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <button type="button" className="btn small" onClick={() => setDeny([...deny, { host: "", reason: "" }])}>+ Add deny rule</button>

          <h3 style={{ fontSize: "0.8rem", margin: "0.9rem 0 0.4rem", color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Budgets</h3>
          <div className="row">
            <label className="field" style={{ flex: 1, margin: 0 }}>Max requests
              <input type="number" min={1} value={budgets.max_requests} onChange={(e) => setBudgets({ ...budgets, max_requests: Number(e.target.value) })} />
            </label>
            <label className="field" style={{ flex: 1, margin: 0 }}>Max requests/sec
              <input type="number" min={0.5} step={0.5} value={budgets.max_rps} onChange={(e) => setBudgets({ ...budgets, max_rps: Number(e.target.value) })} />
            </label>
            <label className="field" style={{ flex: 1, margin: 0 }}>Concurrency
              <input type="number" min={1} value={budgets.max_concurrency} onChange={(e) => setBudgets({ ...budgets, max_concurrency: Number(e.target.value) })} />
            </label>
          </div>
          <label className="field" style={{ marginTop: "0.8rem" }}>Notes
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Source contract / change reason" />
          </label>
        </>
      ) : (
        <label className="field" style={{ marginTop: "0.8rem" }}>Rules (JSON — allow/deny/budgets; deny overrides allow)
          <textarea rows={12} value={json} onChange={(e) => setJson(e.target.value)} className="mono" />
        </label>
      )}

      <label className="field" style={{ marginTop: "0.8rem" }}>Version note
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Initial scope from engagement contract" />
      </label>
      {error && <div className="msg error" role="alert">{error}</div>}
      <div className="row">
        <button className="btn primary" disabled={busy}>{busy ? "Proposing…" : "Propose version"}</button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      <p className="hint">
        Next: <strong>Approve</strong> → <strong>Activate</strong> on the version card below. In multi-member orgs a
        <em> different</em> operator must activate (segregation of duties); solo orgs may self-activate — it is audited
        distinctly. Campaigns unlock the moment a version is ACTIVE.
      </p>
    </form>
  );
}
