import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, isAbsolute, matchesGlob } from "node:path";
import { CONFIG_FILENAMES, loadConfigFile } from "../config.ts";
import type { CompleteFn } from "../llm/judgement.ts";
import { validateEnforcementPolicy } from "./policy.ts";
import type { EnforcementPolicy, RuleResult } from "./policy.ts";
import { checkProjectRules, validateExecutionEvidence } from "./check.ts";
import { reviewDocuments } from "./documents.ts";
import type { DocumentResult } from "./documents.ts";
import { containedPath } from "./resolve.ts";
export interface EnforcementResult {
  status: "pass" | "fail" | "incomplete";
  policyRevision?: string;
  reviewedRevision?: string;
  changedFiles: string[];
  policyChanges: string[];
  rules: RuleResult[];
  documents: DocumentResult[];
  reasons: string[];
}
function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}
function nul(text: string): string[] { return text.split("\0").filter(Boolean); }
function bytes(root: string, path: string): string | null {
  try { return readFileSync(containedPath(root, path), "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
export async function runEnforcement(options: {
  root: string; baselineRef?: string; policy?: EnforcementPolicy; evidenceFile?: string; complete?: CompleteFn;
}): Promise<EnforcementResult | undefined> {
  if (!options.policy && !options.baselineRef) return undefined;
  let temporary: string | undefined;
  let added = false;
  const result: EnforcementResult = { status: "incomplete", changedFiles: [], policyChanges: [], rules: [], documents: [], reasons: [] };
  try {
    let trustedRoot = options.root;
    let policy = options.policy;
    const head = git(options.root, ["rev-parse", "HEAD"]).trim();
    result.reviewedRevision = head;
    if (options.baselineRef) {
      const base = git(options.root, ["rev-parse", "--verify", "--end-of-options", `${options.baselineRef}^{commit}`]).trim();
      result.policyRevision = base;
      temporary = mkdtempSync(join(tmpdir(), "harrier-rules-"));
      trustedRoot = join(temporary, "source");
      git(options.root, ["-c", "core.hooksPath=/dev/null", "worktree", "add", "--detach", trustedRoot, base]);
      added = true;
      // Never fall back to working-tree policy when the base has no enforcement section.
      policy = validateEnforcementPolicy(loadConfigFile(trustedRoot)?.enforcement);
      result.changedFiles = [...new Set([...nul(git(options.root, ["diff", "--name-only", "-z", "--no-renames", base, "--"])), ...nul(git(options.root, ["ls-files", "--others", "--exclude-standard", "-z"]))])].sort();
    } else {
      result.changedFiles = nul(git(options.root, ["ls-files", "-z"])).sort();
      result.changedFiles.push(...nul(git(options.root, ["ls-files", "--others", "--exclude-standard", "-z"])));
    }
    if (!policy) return undefined;
    const before: Record<string, string | null> = {};
    const after: Record<string, string | null> = {};
    for (const rule of policy.rules) if (rule.checker.kind === "dependency-ledger") {
      const checker = rule.checker;
      for (const path of [...result.changedFiles.filter(p => checker.manifests.some(m => matchesGlob(p, m))), checker.ledger]) {
        if (options.baselineRef) before[path] = bytes(trustedRoot, path);
        after[path] = bytes(options.root, path);
      }
    }
    let evidence;
    if (options.evidenceFile) {
      const evidencePath = realpathSync(options.evidenceFile);
      const rel = relative(realpathSync(options.root), evidencePath);
      if (!isAbsolute(rel) && rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\")) throw new Error("Test evidence must come from a trusted producer outside the reviewed repository");
      if (git(options.root, ["status", "--porcelain", "--untracked-files=all"]).trim()) throw new Error("Revision-bound evidence cannot attest a dirty working tree");
      evidence = validateExecutionEvidence(JSON.parse(readFileSync(evidencePath, "utf8")));
    }
    const sources = new Set([...CONFIG_FILENAMES, ...policy.rules.map(r => r.source.path), ...policy.documents.flatMap(d => d.paths)]);
    result.policyChanges = result.changedFiles.filter(path => path.endsWith("AGENTS.md") || [...sources].some(p => path === p || path.startsWith(`${p}/`)));
    result.rules = checkProjectRules({ root: options.root, trustedRoot, policy, changedFiles: result.changedFiles,
      revision: head, ...(evidence ? { evidence } : {}), ...(options.baselineRef ? { before, after } : {}) });
    result.documents = await reviewDocuments({ root: options.root, trustedRoot, policy, changedFiles: result.changedFiles, ...(options.complete ? { complete: options.complete } : {}) });
    const gaps = [...result.rules.filter(r => r.required && r.status === "incomplete").map(r => r.ruleId), ...result.documents.filter(d => d.required && d.status === "incomplete").map(d => `${d.sourceId}:${d.file}`)];
    const failures = [...result.rules.filter(r => r.required && r.status === "fail").map(r => r.ruleId), ...result.documents.filter(d => d.required && d.status === "fail").map(d => `${d.sourceId}:${d.file}`)];
    result.status = gaps.length ? "incomplete" : failures.length ? "fail" : "pass";
    if (gaps.length) result.reasons.push(`Required compliance checks incomplete: ${gaps.join(", ")}`);
    if (failures.length) result.reasons.push(`Required compliance violations: ${failures.join(", ")}`);
    return result;
  } catch (error) {
    result.reasons.push(String(error).slice(0, 1000));
    return result;
  } finally {
    if (temporary) {
      if (added) git(options.root, ["worktree", "remove", "--force", join(temporary, "source")]);
      rmSync(temporary, { recursive: true, force: true });
    }
  }
}
