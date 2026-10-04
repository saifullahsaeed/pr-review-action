import { createHash } from "node:crypto";
import { relative, isAbsolute } from "node:path";
import type { Finding, Report, Severity } from "./findings.ts";
import { SEVERITIES, severityRank } from "./findings.ts";

export interface GatePolicy {
  failOn: Severity | "never";
  scope: "new" | "all";
  requiredProbes: string[];
}
export const DEFAULT_POLICY: GatePolicy = { failOn: "high", scope: "new", requiredProbes: ["metrics", "gitleaks", "semgrep", "osv-scanner"] };
export const KNOWN_PROBES = ["metrics", "gitleaks", "semgrep", "osv-scanner", "eslint", "ruff"];
export interface FindingChange { findingId: string; identity: string; status: "new" | "existing" | "worsened"; baselineId?: string }
export interface GateResult {
  status: "pass" | "fail" | "incomplete";
  exitCode: 0 | 1 | 2;
  policy: GatePolicy;
  baseline: { status: "ok" | "none" | "failed"; commit?: string; detail?: string };
  changes: FindingChange[];
  resolved: string[];
  blockers: string[];
  advisory: string[];
  reasons: string[];
}
export function validateGatePolicy(value: unknown): GatePolicy {
  if (value === undefined) return { ...DEFAULT_POLICY, requiredProbes: [...DEFAULT_POLICY.requiredProbes] };
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("gate must be an object");
  const p = value as Record<string, unknown>;
  for (const key of Object.keys(p)) if (!["failOn", "scope", "requiredProbes"].includes(key)) throw new Error(`unknown gate policy field: ${key}`);
  const failOn = p.failOn === undefined ? DEFAULT_POLICY.failOn : p.failOn;
  const scope = p.scope === undefined ? DEFAULT_POLICY.scope : p.scope;
  const requiredProbes = p.requiredProbes === undefined ? DEFAULT_POLICY.requiredProbes : p.requiredProbes;
  if (![...SEVERITIES, "never"].includes(failOn as Severity)) throw new Error("gate.failOn must be critical, high, medium, low, info or never");
  if (scope !== "new" && scope !== "all") throw new Error("gate.scope must be new or all");
  if (!Array.isArray(requiredProbes) || requiredProbes.some(x => typeof x !== "string" || !KNOWN_PROBES.includes(x))) throw new Error(`gate.requiredProbes must contain known probes: ${KNOWN_PROBES.join(", ")}`);
  return { failOn: failOn as GatePolicy["failOn"], scope, requiredProbes: [...new Set(requiredProbes as string[])] };
}
export function relativeFinding(f: Finding, root: string): Finding {
  const clean = (s: string): string => s.split(root).join(".");
  return { ...f, message: clean(f.message), ...(f.evidence !== undefined ? { evidence: clean(f.evidence) } : {}), locations: f.locations.map(l => ({ ...l, path: (isAbsolute(l.path) ? relative(root, l.path) : l.path).replaceAll("\\", "/").replace(/^\.\//, "") })) };
}
/** Gate identity ignores line drift and severity, but not evidence or occurrence count. */
export function gateIdentity(f: Finding): string {
  const norm = (s: string): string => s.trim().replace(/\s+/g, " ");
  const basis = [f.source, f.probe ?? "", f.ruleId, ...f.locations.map(l => l.path).sort(), norm(f.message), norm(f.evidence ?? "")];
  return createHash("sha256").update(JSON.stringify(basis)).digest("hex");
}
export function evaluateGate(report: Report, policy: GatePolicy, baseline?: Report, baselineInfo: GateResult["baseline"] = { status: "none" }): GateResult {
  const reasons: string[] = [];
  const changes: FindingChange[] = [];
  const remaining = new Map<string, Finding[]>();
  for (const f of baseline?.findings ?? []) {
    if (f.source !== "probe") continue;
    const key = gateIdentity(f);
    remaining.set(key, [...(remaining.get(key) ?? []), f]);
  }
  // Strongest matches first prevents a severity downgrade masking another worsened occurrence.
  for (const list of remaining.values()) list.sort((a,b) => severityRank(a.severity) - severityRank(b.severity));
  const blockers: string[] = [];
  const advisory: string[] = [];
  for (const f of [...report.findings].sort((a,b) => severityRank(a.severity) - severityRank(b.severity))) {
    if (f.source === "llm") { advisory.push(f.id); continue; }
    const identity = gateIdentity(f);
    const previous = remaining.get(identity)?.shift();
    const status = previous ? (severityRank(f.severity) < severityRank(previous.severity) ? "worsened" : "existing") : "new";
    changes.push({ findingId: f.id, identity, status, ...(previous ? { baselineId: previous.id } : {}) });
    if (policy.failOn !== "never" && severityRank(f.severity) <= severityRank(policy.failOn) && (policy.scope === "all" || status !== "existing")) blockers.push(f.id);
  }
  for (const probe of policy.requiredProbes) {
    const run = report.probes?.find(r => r.probe === probe);
    if (run?.status !== "ok") reasons.push(`Required check ${probe}: ${run?.status ?? "missing"}${run?.detail ? ` — ${run.detail}` : ""}`);
  }
  if (baselineInfo.status === "failed") reasons.push(`Baseline unavailable: ${baselineInfo.detail ?? "scan failed"}`);
  if (baseline) {
    const needed = new Set([...policy.requiredProbes, ...(report.probes ?? []).filter(r => r.status === "ok" && KNOWN_PROBES.includes(r.probe)).map(r => r.probe)]);
    for (const probe of needed) {
      const run = baseline.probes?.find(r => r.probe === probe);
      if (run?.status !== "ok") reasons.push(`Baseline check ${probe}: ${run?.status ?? "missing"}${run?.detail ? ` — ${run.detail}` : ""}`);
    }
  }
  const compliance = report.enforcement;
  if (compliance?.status === "incomplete") reasons.push(...compliance.reasons);
  const status = reasons.length ? "incomplete" : blockers.length || compliance?.status === "fail" ? "fail" : "pass";
  if (compliance?.status === "fail") reasons.push(...compliance.reasons);
  if (blockers.length) reasons.push(`${blockers.length} deterministic finding(s) violate the ${policy.scope}-findings threshold (${policy.failOn})`);
  return { status, exitCode: status === "pass" ? 0 : status === "fail" ? 1 : 2, policy, baseline: baselineInfo, changes, resolved: baseline && status !== "incomplete" ? [...remaining.values()].flat().filter(f => report.probes?.some(r => r.probe === f.probe && r.status === "ok")).map(f => f.id) : [], blockers, advisory, reasons };
}
export function renderGateMarkdown(gate: GateResult, report: Report): string {
  const count = (s: FindingChange["status"]): number => gate.changes.filter(c => c.status === s).length;
  const lines = ["<!-- harrier-quality-gate -->", `# Harrier quality gate — ${gate.status.toUpperCase()}`, "", `New: **${count("new")}** · Worsened: **${count("worsened")}** · Existing: **${count("existing")}** · Resolved: **${gate.resolved.length}** · AI advisory: **${gate.advisory.length}**`, "", `Policy: block **${gate.policy.scope}** deterministic findings at **${gate.policy.failOn}** or above.`, `Baseline: **${gate.baseline.status}**${gate.baseline.commit ? ` (${gate.baseline.commit})` : ""}.`, ""];
  for (const reason of gate.reasons) lines.push(`- ${reason}`);
  if (gate.blockers.length) {
    lines.push("", "## Blockers", "");
    for (const id of gate.blockers) {
      const f = report.findings.find(f => f.id === id)!;
      lines.push(`- **${f.severity}** · \`${f.ruleId}\` · \`${f.locations[0]?.path}:${f.locations[0]?.startLine}\` — ${f.message}`);
    }
  }
  lines.push("", "## Check coverage", "");
  for (const r of report.probes ?? []) lines.push(`- ${r.probe}: **${r.status}**${gate.policy.requiredProbes.includes(r.probe) ? " (required)" : ""}${r.detail ? ` — ${r.detail}` : ""}`);
  lines.push("", "General AI code-review findings are advisory. Required project-document compliance is enforced separately and is model-reviewed, not deterministic proof. No baseline means all deterministic findings are new. Resolved counts are withheld when comparison is incomplete.", "");
  return lines.join("\n");
}
