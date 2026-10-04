import { posix } from "node:path";
import { SEVERITIES } from "../findings.ts";
import type { Severity } from "../findings.ts";

export interface RuleSource { path: string; startLine: number; endLine?: number }
export interface DocumentSource {
  id: string;
  paths: string[];
  scope: string[];
  exclude: string[];
  required: boolean;
  /** standards = requirements; reference = context only, not automatic blocking policy. */
  role: "standards" | "reference";
}
export type RuleChecker =
  | { kind: "python-call"; forbidden: string[] }
  | { kind: "python-import"; forbidden: string[] }
  | { kind: "dependency-ledger"; manifests: string[]; ledger: string }
  | { kind: "evidence"; checkId: string }
  | { kind: "semantic"; instructions: string };
export interface ProjectRule {
  id: string;
  description: string;
  status: "approved" | "proposed";
  required: boolean;
  severity: Severity;
  scope: string[];
  exclude: string[];
  source: RuleSource;
  checker: RuleChecker;
}
export interface EnforcementPolicy {
  version: 1;
  rules: ProjectRule[];
  documents: DocumentSource[];
  agents: { enabled: boolean; required: boolean };
  maxContextChars: number;
}
export interface RuleEvidence { path?: string; line?: number; detail: string }
export interface RuleResult {
  ruleId: string;
  status: "pass" | "fail" | "incomplete" | "not-applicable";
  required: boolean;
  source: RuleSource;
  checkedFiles: string[];
  evidence: RuleEvidence[];
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[], label: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${label}: unknown field ${key}`);
}
function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a nonempty string`);
  return value;
}
/** Portable relative paths only. Never normalize away a traversal before validating it. */
export function projectPath(value: unknown, label = "path", pattern = false): string {
  const path = text(value, label);
  if (path.includes("\\") || path.includes("\0") || path.startsWith("/") || /^[A-Za-z]:/.test(path)
    || path.split("/").some(part => part === ".." || part === "." || part === "")) {
    throw new Error(`${label} must be a contained, slash-separated relative path`);
  }
  if (!pattern && /[*?\[\]{}]/.test(path)) throw new Error(`${label} must be a literal path`);
  if (pattern && /[!{}]/.test(path)) throw new Error(`${label}: negation and brace patterns are unsupported; use exclude`);
  return posix.normalize(path);
}
function strings(value: unknown, label: string, paths = false): string[] {
  if (!Array.isArray(value) || !value.length) throw new Error(`${label} must be a nonempty array`);
  return value.map(v => paths ? projectPath(v, label, true) : text(v, label));
}
function checker(value: unknown): RuleChecker {
  const c = record(value, "checker");
  switch (c.kind) {
    case "python-call":
    case "python-import": {
      keys(c, ["kind", "forbidden"], "checker");
      const forbidden = strings(c.forbidden, "checker.forbidden");
      if (forbidden.some(p => !/^([A-Za-z_][\w]*|\*)(\.([A-Za-z_][\w]*|\*))*$/.test(p))) throw new Error("checker.forbidden requires dotted names with optional * segments");
      return { kind: c.kind, forbidden };
    }
    case "dependency-ledger":
      keys(c, ["kind", "manifests", "ledger"], "checker");
      return { kind: c.kind, manifests: strings(c.manifests, "checker.manifests", true), ledger: projectPath(c.ledger, "checker.ledger") };
    case "evidence":
      keys(c, ["kind", "checkId"], "checker");
      return { kind: c.kind, checkId: text(c.checkId, "checker.checkId") };
    case "semantic":
      keys(c, ["kind", "instructions"], "checker");
      return { kind: c.kind, instructions: text(c.instructions, "checker.instructions") };
    default: throw new Error(`unsupported checker kind: ${String(c.kind)}`);
  }
}

/** Explicit approval is an operator assertion, never inferred from Markdown wording. */
export function validateEnforcementPolicy(value: unknown): EnforcementPolicy | undefined {
  if (value === undefined) return undefined;
  const p = record(value, "enforcement");
  keys(p, ["version", "rules", "documents", "agents", "maxContextChars"], "enforcement");
  if (p.version !== 1) throw new Error("enforcement.version must be 1");
  const entries = p.rules === undefined ? [] : p.rules;
  if (!Array.isArray(entries)) throw new Error("enforcement.rules must be an array");
  const seen = new Set<string>();
  const rules = entries.map((item): ProjectRule => {
    const r = record(item, "rule");
    keys(r, ["id", "description", "status", "required", "severity", "scope", "exclude", "source", "checker"], "rule");
    const id = text(r.id, "rule.id");
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id) || seen.has(id)) throw new Error(`invalid or duplicate rule id: ${id}`);
    seen.add(id);
    if (r.status !== "approved" && r.status !== "proposed") throw new Error(`${id}: status must explicitly be approved or proposed`);
    if (typeof r.required !== "boolean") throw new Error(`${id}: required must explicitly be boolean`);
    if (r.status === "proposed" && r.required) throw new Error(`${id}: proposed rules cannot be required`);
    if (!SEVERITIES.includes(r.severity as Severity)) throw new Error(`${id}: invalid severity`);
    const s = record(r.source ?? { path: "harrier.config.json", startLine: 1 }, `${id}.source`);
    keys(s, ["path", "startLine", "endLine"], "source");
    if (!Number.isSafeInteger(s.startLine) || (s.startLine as number) < 1) throw new Error(`${id}: invalid source startLine`);
    if (s.endLine !== undefined && (!Number.isSafeInteger(s.endLine) || (s.endLine as number) < (s.startLine as number))) throw new Error(`${id}: invalid source endLine`);
    const exclude = r.exclude === undefined || (Array.isArray(r.exclude) && r.exclude.length === 0) ? [] : strings(r.exclude, "rule.exclude", true);
    return {
      id, description: text(r.description, "rule.description"), status: r.status, required: r.required,
      severity: r.severity as Severity, scope: strings(r.scope, "rule.scope", true), exclude,
      source: { path: projectPath(s.path, "source.path"), startLine: s.startLine as number, ...(s.endLine === undefined ? {} : { endLine: s.endLine as number }) },
      checker: checker(r.checker),
    };
  });
  const documents: DocumentSource[] = [];
  if (p.documents !== undefined) {
    if (!Array.isArray(p.documents)) throw new Error("enforcement.documents must be an array");
    for (const item of p.documents) {
      const d = record(item, "document");
      keys(d, ["id", "paths", "scope", "exclude", "required", "role"], "document");
      const id = text(d.id, "document.id");
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id) || seen.has(id)) throw new Error(`invalid or duplicate source id: ${id}`);
      seen.add(id);
      if (typeof d.required !== "boolean") throw new Error(`${id}: required must be boolean`);
      if (d.role !== "standards" && d.role !== "reference") throw new Error(`${id}: role must be standards or reference`);
      documents.push({ id, paths: strings(d.paths, "document.paths").map(path => projectPath(path, "document.paths")),
        scope: strings(d.scope, "document.scope", true), exclude: d.exclude === undefined || (Array.isArray(d.exclude) && !d.exclude.length) ? [] : strings(d.exclude, "document.exclude", true),
        required: d.required, role: d.role });
    }
  }
  const agents = p.agents === undefined ? { enabled: false, required: false } : record(p.agents, "agents");
  keys(agents, ["enabled", "required"], "agents");
  if (typeof agents.enabled !== "boolean" || typeof agents.required !== "boolean" || (!agents.enabled && agents.required)) throw new Error("agents needs boolean enabled/required; disabled agents cannot be required");
  const maxContextChars = p.maxContextChars ?? 48000;
  if (!Number.isSafeInteger(maxContextChars) || (maxContextChars as number) < 1000 || (maxContextChars as number) > 1000000) throw new Error("maxContextChars must be an integer from 1000 to 1000000");
  return { version: 1, rules, documents, agents: { enabled: agents.enabled, required: agents.required }, maxContextChars: maxContextChars as number };
}
