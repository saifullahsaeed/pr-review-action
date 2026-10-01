import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Report } from "./findings.ts";
import { review } from "./pipeline.ts";
import type { ReviewOptions, ReviewArtifacts } from "./pipeline.ts";
import { evaluateGate, relativeFinding, renderGateMarkdown } from "./gate.ts";
import type { GatePolicy, GateResult } from "./gate.ts";
import { renderJson } from "./render/json.ts";
import { renderMarkdown } from "./render/markdown.ts";
import { renderSarif } from "./render/sarif.ts";
import { renderHtml } from "./render/html.ts";

export function resolveCommit(root: string, ref: string): string {
  return execFileSync("git", ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
export async function qualityReview(options: ReviewOptions, policy: GatePolicy, baselineRef?: string): Promise<ReviewArtifacts & { gate: GateResult }> {
  let baseline: Report | undefined;
  let baselineInfo: GateResult["baseline"] = { status: "none" };
  if (baselineRef !== undefined) {
    let temporary: string | undefined;
    let added = false;
    try {
      const commit = resolveCommit(options.root, baselineRef);
      temporary = mkdtempSync(join(tmpdir(), "harrier-baseline-"));
      const root = join(temporary, "source");
      execFileSync("git", ["-c", "core.hooksPath=/dev/null", "worktree", "add", "--detach", root, commit], { cwd: options.root, stdio: "pipe" });
      added = true;
      const scanned = await review({ root, outDir: join(temporary, "report"), ...(options.probes ? { probes: options.probes } : {}), ...(options.probeOptions ? { probeOptions: options.probeOptions } : {}), ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}) });
      baseline = { ...scanned.report, findings: scanned.report.findings.map(f => relativeFinding(f, root)) };
      baselineInfo = { status: "ok", commit };
    } catch (error) {
      baselineInfo = { status: "failed", detail: error instanceof Error ? error.message : String(error) };
    } finally {
      if (temporary) {
        if (added) execFileSync("git", ["worktree", "remove", "--force", join(temporary, "source")], { cwd: options.root, stdio: "pipe" });
        rmSync(temporary, { recursive: true, force: true });
      }
    }
  }
  // Gate evidence must not be hidden by report display filters.
  const { categories: _categories, minSeverity: _severity, ...unfiltered } = options;
  const artifacts = await review(unfiltered);
  artifacts.report.findings = artifacts.report.findings.map(f => relativeFinding(f, options.root));
  const gate = evaluateGate(artifacts.report, policy, baseline, baselineInfo);
  artifacts.report.gate = gate;
  writeFileSync(artifacts.paths.json, renderJson(artifacts.report));
  writeFileSync(artifacts.paths.sarif, renderSarif(artifacts.report));
  writeFileSync(artifacts.paths.html, renderHtml(artifacts.report));
  writeFileSync(artifacts.paths.markdown, renderGateMarkdown(gate, artifacts.report) + "\n" + renderMarkdown(artifacts.report));
  writeFileSync(join(options.outDir, "gate.json"), JSON.stringify(gate, null, 2) + "\n");
  return { ...artifacts, gate };
}
