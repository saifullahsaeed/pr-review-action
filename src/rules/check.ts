import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { posix, matchesGlob } from "node:path";
import type { EnforcementPolicy, ProjectRule, RuleResult, RuleEvidence } from "./policy.ts";
import { containedPath, readRuleSource, resolveRules, ruleApplies } from "./resolve.ts";

export interface ExecutionEvidence {
  version: 1;
  revision: string;
  checks: { checkId: string; exitCode: number; command: string }[];
}
export interface RuleCheckOptions {
  root: string;
  /** Source citations and ancestors are read here, never from a PR's modified rule files. */
  trustedRoot: string;
  policy: EnforcementPolicy;
  changedFiles: string[];
  revision?: string;
  evidence?: ExecutionEvidence;
  /** Exact base/current manifest and ledger bytes supplied by the trusted revision reader. */
  before?: Record<string, string | null>;
  after?: Record<string, string | null>;
}
interface PythonFacts {
  calls: { name: string; resolved: string; line: number }[];
  imports: { name: string; level: number; line: number }[];
}
function matchName(name: string, pattern: string): boolean {
  const escaped = pattern.split(".").map((p, index) => p === "*" ? index === 0 ? ".+" : "[^.]+" : p).join("\\.");
  return new RegExp(`^${escaped}(?:\\..*)?$`).test(name);
}
function parsePython(root: string, path: string): PythonFacts {
  const source = readFileSync(containedPath(root, path), "utf8");
  const script = fileURLToPath(new URL("./python_ast.py", import.meta.url));
  const output = spawnSync("python3", ["-I", script], { input: source, encoding: "utf8", timeout: 10000, maxBuffer: 8 * 1024 * 1024 });
  if (output.error) throw output.error;
  if (output.status !== 0) throw new Error(`Python parse incomplete for ${path}: ${output.stdout || output.stderr}`);
  const facts = JSON.parse(output.stdout) as PythonFacts;
  if (!Array.isArray(facts.calls) || !Array.isArray(facts.imports)) throw new Error("Malformed parser result");
  return facts;
}
function importName(path: string, item: PythonFacts["imports"][number]): string {
  if (item.level === 0) return item.name;
  // Configurations match repository-relative module names. Absolute imports retain their Python spelling.
  const parts = posix.dirname(path).split("/");
  if (item.level > parts.length) throw new Error(`Relative import escapes project in ${path}:${item.line}`);
  return [...parts.slice(0, parts.length - item.level + 1), item.name].filter(Boolean).join(".");
}
export function validateExecutionEvidence(value: unknown): ExecutionEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Evidence must be an object");
  const e = value as Record<string, unknown>;
  if (Object.keys(e).some(k => !["version", "revision", "checks"].includes(k)) || e.version !== 1 || typeof e.revision !== "string" || !/^[a-f0-9]{40,64}$/.test(e.revision) || !Array.isArray(e.checks)) throw new Error("Invalid execution evidence envelope");
  const ids = new Set<string>();
  const checks = e.checks.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid evidence check");
    const c = item as Record<string, unknown>;
    if (Object.keys(c).some(k => !["checkId", "exitCode", "command"].includes(k)) || typeof c.checkId !== "string" || !c.checkId.trim() || ids.has(c.checkId) || !Number.isSafeInteger(c.exitCode) || typeof c.command !== "string" || !c.command.trim()) throw new Error("Invalid or duplicate evidence check");
    ids.add(c.checkId);
    return { checkId: c.checkId, exitCode: c.exitCode as number, command: c.command };
  });
  return { version: 1, revision: e.revision, checks };
}

/** Per-rule results never turn tooling, source or evidence gaps into a pass. */
export function checkProjectRules(options: RuleCheckOptions): RuleResult[] {
  const cache = new Map<string, PythonFacts>();
  return options.policy.rules.map((rule): RuleResult => {
    const files = [...new Set(options.changedFiles)].filter(path => ruleApplies(rule, path));
    const evidence: RuleEvidence[] = [];
    const result: RuleResult = { ruleId: rule.id, status: "not-applicable", required: rule.required && rule.status === "approved", source: rule.source, checkedFiles: [], evidence };
    if (!files.length) return result;
    try {
      readRuleSource(options.trustedRoot, rule.source);
      for (const path of files) resolveRules(options.trustedRoot, path, options.policy);
      if (rule.checker.kind === "semantic") {
        result.status = "incomplete";
        evidence.push({ detail: "Semantic requirements have no deterministic verification; AI review is advisory" });
      } else if (rule.checker.kind === "evidence") {
        checkEvidence(rule, options, result);
      } else if (rule.checker.kind === "dependency-ledger") {
        checkLedger(rule, files, options, result);
      } else {
        let violations = false;
        let gaps = false;
        for (const path of files) {
          if (!path.endsWith(".py")) { gaps = true; evidence.push({ path, detail: "Python checker cannot inspect non-Python file" }); continue; }
          try {
            let facts = cache.get(path);
            if (!facts) { facts = parsePython(options.root, path); cache.set(path, facts); }
            result.checkedFiles.push(path);
            if (rule.checker.kind === "python-call") {
              for (const call of facts.calls) if (rule.checker.forbidden.some(p => matchName(call.name, p) || matchName(call.resolved, p))) {
                violations = true; evidence.push({ path, line: call.line, detail: `Forbidden call: ${call.name} (resolved: ${call.resolved})` });
              }
            } else {
              for (const item of facts.imports) {
                const name = importName(path, item);
                if (rule.checker.forbidden.some(p => matchName(name, p))) {
                  violations = true; evidence.push({ path, line: item.line, detail: `Forbidden import: ${name}` });
                }
              }
            }
          } catch (error) { gaps = true; evidence.push({ path, detail: String(error).slice(0, 1000) }); }
        }
        result.status = gaps ? "incomplete" : violations ? "fail" : "pass";
        if (!evidence.length) evidence.push({ detail: `${result.checkedFiles.length} Python file(s) inspected; no prohibited syntax found. Dynamic dispatch is outside this checker.` });
      }
    } catch (error) { result.status = "incomplete"; evidence.push({ detail: String(error).slice(0, 1000) }); }
    return result;
  });
}

function checkEvidence(rule: ProjectRule, options: RuleCheckOptions, result: RuleResult): void {
  if (rule.checker.kind !== "evidence") return;
  const e = options.evidence;
  if (!e || !options.revision || e.revision !== options.revision) {
    result.status = "incomplete";
    result.evidence.push({ detail: "Missing trusted test evidence tied to the exact reviewed revision" });
    return;
  }
  const id = rule.checker.checkId;
  const supplied = e.checks.find(c => c.checkId === id);
  result.status = !supplied ? "incomplete" : supplied.exitCode === 0 ? "pass" : "fail";
  result.evidence.push({ detail: supplied ? `${supplied.command}: exit ${supplied.exitCode} at ${e.revision}; trusted producer attestation, not execution by Harrier` : `Required execution evidence missing: ${id}` });
}

function checkLedger(rule: ProjectRule, files: string[], options: RuleCheckOptions, result: RuleResult): void {
  if (rule.checker.kind !== "dependency-ledger") return;
  const c = rule.checker;
  const manifests = files.filter(path => c.manifests.some(p => matchesGlob(path, p)));
  if (!manifests.length) { result.status = "not-applicable"; return; }
  if (!options.before || !options.after) { result.status = "incomplete"; result.evidence.push({ detail: "Dependency comparison requires trusted base and current bytes" }); return; }
  const beforeLedger = options.before[c.ledger];
  const afterLedger = options.after[c.ledger];
  if (beforeLedger === undefined || afterLedger === undefined || afterLedger === null) { result.status = "incomplete"; result.evidence.push({ detail: "Dependency ledger comparison unavailable" }); return; }
  const newRows = afterLedger.split(/\r?\n/).filter(line => !(beforeLedger ?? "").split(/\r?\n/).includes(line));
  let failed = false;
  for (const path of manifests) {
    const before = options.before[path]; const after = options.after[path];
    if (before === undefined || after === undefined) throw new Error(`Missing manifest comparison: ${path}`);
    const old = dependencies(path, before); const current = dependencies(path, after);
    for (const name of new Set([...old.keys(), ...current.keys()])) {
      if (old.get(name) === current.get(name)) continue;
      const removed = !current.has(name);
      const packageName = name.slice(name.indexOf(":") + 1);
      const matching = newRows.some(row => {
        const cells = row.split("|").map(cell => cell.trim().replaceAll("`", ""));
        return cells[1] === packageName && Boolean(cells[2]) && Boolean(cells[3])
          && /[A-Za-z]{3}/.test(cells[3]!) && (!removed || /removed/i.test(cells[2]!));
      });
      if (!matching) { failed = true; result.evidence.push({ path, detail: `Dependency ${name} ${removed ? "removed" : old.has(name) ? "changed" : "added"} without a changed ledger row documenting a reason${removed ? " and removal" : ""}` }); }
    }
    result.checkedFiles.push(path);
  }
  result.status = failed ? "fail" : "pass";
  if (!result.evidence.length) result.evidence.push({ detail: "Manifest dependency deltas have corresponding changed ledger rows; reason quality still requires review" });
}
function dependencies(path: string, content: string | null): Map<string, string> {
  if (content === null) return new Map();
  if (path.endsWith("package.json")) {
    const data = JSON.parse(content) as Record<string, unknown>;
    const out = new Map<string, string>();
    for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
      const value = data[section];
      if (value === undefined) continue;
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${section}`);
      for (const [name, version] of Object.entries(value)) {
        if (typeof version !== "string") throw new Error(`Invalid dependency version: ${name}`);
        out.set(`${section}:${name}`, version);
      }
    }
    return out;
  }
  if (/requirements[^/]*\.txt$/.test(path)) {
    const out = new Map<string, string>();
    for (const raw of content.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const match = /^([A-Za-z0-9_.-]+)(?:\[[^\]]+\])?\s*((?:[<>=!~].*)?)$/.exec(line);
      if (!match) throw new Error(`Unsupported requirements syntax in ${path}: ${line}`);
      out.set(match[1]!.toLowerCase().replace(/[-_.]+/g, "-"), match[2]!);
    }
    return out;
  }
  throw new Error(`Unsupported dependency manifest: ${path}; configure supported package.json or requirements*.txt`);
}
