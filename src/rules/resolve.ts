import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, matchesGlob } from "node:path";
import { projectPath } from "./policy.ts";
import type { EnforcementPolicy, ProjectRule, RuleSource } from "./policy.ts";

export interface AgentDocument { path: string; text: string }
export interface ResolvedRules {
  path: string;
  ancestors: AgentDocument[];
  rules: ProjectRule[];
  /** These documents inform review, not automatic precedence or approval inference. */
  inheritance: "explicit-policy";
}

/** Missing paths are allowed for deletions; existing ancestors must still remain contained. */
export function containedPath(root: string, path: string): string {
  projectPath(path);
  const realRoot = realpathSync(root);
  const target = resolve(realRoot, path);
  let ancestor = target;
  while (!existsSync(ancestor) && ancestor !== realRoot) ancestor = dirname(ancestor);
  const actual = realpathSync(ancestor);
  const rel = relative(realRoot, actual);
  if (rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(rel)) {
    throw new Error(`path escapes project via symlink: ${path}`);
  }
  return target;
}

export function ruleApplies(rule: ProjectRule, path: string): boolean {
  projectPath(path);
  return rule.scope.some(pattern => matchesGlob(path, pattern))
    && !rule.exclude.some(pattern => matchesGlob(path, pattern));
}

/** Root-to-local chain, with original text retained including proposed sections. */
export function resolveRules(root: string, path: string, policy?: EnforcementPolicy): ResolvedRules {
  const target = containedPath(root, path);
  const ancestors: AgentDocument[] = [];
  const parent = relative(realpathSync(root), dirname(target)).replaceAll("\\", "/");
  const directories = ["", ...parent.split("/").filter(Boolean).map((_, i, parts) => parts.slice(0, i + 1).join("/"))];
  for (const dir of directories) {
    const agentPath = dir ? `${dir}/AGENTS.md` : "AGENTS.md";
    const full = containedPath(root, agentPath);
    if (!existsSync(full)) continue;
    if (!statSync(full).isFile()) throw new Error(`${agentPath} is not a file`);
    ancestors.push({ path: agentPath, text: readFileSync(full, "utf8") });
  }
  return { path, ancestors, rules: (policy?.rules ?? []).filter(rule => ruleApplies(rule, path)), inheritance: "explicit-policy" };
}

/** A missing or stale rule citation is a coverage error, not a successful check. */
export function readRuleSource(root: string, source: RuleSource): AgentDocument {
  const full = containedPath(root, source.path);
  const lines = readFileSync(full, "utf8").split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  const end = source.endLine ?? source.startLine;
  if (source.startLine > lines.length || end > lines.length) throw new Error(`source range missing: ${source.path}:${source.startLine}-${end}`);
  return { path: source.path, text: lines.slice(source.startLine - 1, end).join("\n") };
}
