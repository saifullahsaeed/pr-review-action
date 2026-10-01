import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Category, FindingInput, ProbeRun, Report, Severity } from "./findings.ts";
import { severityRank } from "./findings.ts";
import { buildReport } from "./report.ts";
import { renderHtml } from "./render/html.ts";
import { renderJson } from "./render/json.ts";
import { renderMarkdown } from "./render/markdown.ts";
import { renderSarif } from "./render/sarif.ts";
import { planBatches, validateBatchBudget } from "./llm/batches.ts";
import type { BatchBudget, AiCoverage } from "./llm/batches.ts";
import type { CompleteFn } from "./llm/judgement.ts";
import { runJudgement } from "./llm/judgement.ts";
import { verifyCandidateFindings } from "./llm/verifier.ts";
import type { JudgementPass } from "./llm/prompts.ts";
import {
  eslintProbe,
  gitleaksProbe,
  metricsProbe,
  osvScannerProbe,
  ruffProbe,
  runProbes,
  semgrepProbe,
} from "./probes/run.ts";
import type { Probe } from "./probes/types.ts";

export const TOOL_VERSION = "0.1.0";

export const DEFAULT_PROBES: Probe[] = [
  osvScannerProbe,
  gitleaksProbe,
  semgrepProbe,
  eslintProbe,
  ruffProbe,
  metricsProbe,
];

const CATEGORY_OF_PASS: Record<JudgementPass, Category> = {
  structure: "structure",
  quality: "quality",
  bug: "bug",
};

/**
 * A finding in a tooling artifact (`.claude/worktrees/` and friends) is out of scope: those are
 * stale copies of the repo, not code under review. External scanners walk the directory
 * themselves and cannot know that, so the scope is enforced here — and recorded, never silent.
 */
export function isArtifactPath(path: string): boolean {
  return path
    .split(/[\\/]+/)
    .some((segment) => segment !== "." && segment !== ".." && segment.startsWith("."));
}

export interface ReviewOptions {
  root: string;
  outDir: string;
  probes?: Probe[];
  probeOptions?: Record<string, string>;
  /** Present = the judgement passes run through it. Absent = probes only, nothing leaves. */
  complete?: CompleteFn;
  /** Why the judgement passes did not run, when they did not. Recorded in probes[]. */
  llmSkippedNote?: string;
  passes?: JudgementPass[];
  categories?: Category[];
  minSeverity?: Severity;
  timeoutMs?: number;
  now?: () => Date;
  diffRef?: string;
  customInstructions?: string;
  budget?: Partial<BatchBudget>;
}

export interface ReviewArtifacts {
  report: Report;
  paths: { json: string; sarif: string; markdown: string; html: string };
}

/** The whole review: probes, judgement passes, one merged findings model, three renderings. */
export async function review(options: ReviewOptions): Promise<ReviewArtifacts> {
  const now = options.now ?? ((): Date => new Date());
  const startedAt = now().toISOString();
  const timeoutMs = options.timeoutMs ?? 120000;

  const sweep = await runProbes(options.probes ?? DEFAULT_PROBES, {
    root: options.root,
    timeoutMs,
    ...(options.probeOptions !== undefined ? { options: options.probeOptions } : {}),
  });
  const runs: ProbeRun[] = [...sweep.runs];
  const findings: FindingInput[] = [];
  let artifactFindings = 0;
  for (const finding of sweep.findings) {
    const path = finding.locations[0]?.path ?? "";
    if (isArtifactPath(path)) {
      artifactFindings += 1;
      continue;
    }
    findings.push(finding);
  }
  let overview: string | undefined;

  let aiCoverage: AiCoverage | undefined;
  if (options.complete !== undefined) {
    const priorFindings = findings.map(f => ({ ruleName: f.ruleName, category: f.category, severity: f.severity, message: f.message, path: f.locations[0]?.path, line: f.locations[0]?.startLine }));
    const passes = options.passes ?? ["structure", "quality", "bug"];
    const overviews: string[] = [];
    try {
      const plan = planBatches(options.root, validateBatchBudget(options.budget), options.diffRef);
      aiCoverage = plan.coverage;
      for (const [index, batch] of plan.batches.entries()) {
        const localHints = priorFindings.filter(f => f.path && batch.context.included.includes(f.path));
        const judgement = await runJudgement(options.complete, batch.context, passes, localHints, options.customInstructions);
        artifactFindings += judgement.dropped.filter(f => typeof f.path === "string" && isArtifactPath(f.path)).length;
        const verified = await verifyCandidateFindings(options.complete, batch.context, judgement.findings);
        findings.push(...verified.verified);
        aiCoverage.batches.push({ index: index + 1, ranges: batch.ranges, supportRanges: batch.supportRanges, passes: judgement.passes, verifier: verified.status });
        if (judgement.passes.some(p => p.status !== "ok") || verified.status === "failed") aiCoverage.status = "partial";
        if (judgement.overview) overviews.push(`Batch ${index + 1}: ${judgement.overview}`);
      }
      if (passes.length === 0) { aiCoverage.status = "disabled"; aiCoverage.detail = "No AI review passes configured"; }
      for (const pass of passes) {
        const failures = aiCoverage.batches.filter(b => b.passes.some(p => p.pass === pass && p.status !== "ok"));
        runs.push({ probe: `llm/${pass}`, categories: [CATEGORY_OF_PASS[pass]], status: failures.length ? "failed" : "ok", detail: `${aiCoverage.batches.length} batches; ${failures.length} failed for this pass` });
      }
      runs.push({ probe: "llm/coverage", categories: ["structure", "quality", "bug"], status: aiCoverage.status === "complete" ? "ok" : aiCoverage.status === "disabled" ? "skipped" : "failed", detail: `${aiCoverage.status}: ${aiCoverage.plannedFiles} planned files, ${aiCoverage.batches.length} batches, ${aiCoverage.skipped.length} excluded/unreviewed ranges` });
      const verifierFailed = aiCoverage.batches.some(b => b.verifier === "failed");
      runs.push({ probe: "llm/verifier", categories: ["structure", "quality", "bug"], status: verifierFailed ? "failed" : "ok", detail: verifierFailed ? "At least one batch verifier failed; original advisory findings retained" : "Verification completed or no candidates needed verification" });
      overview = overviews.join("\n\n") || undefined;
    } catch (error) {
      aiCoverage = { status: "failed", mode: options.diffRef === undefined ? "repository" : "diff", plannedFiles: 0, plannedRanges: [], batches: [], skipped: [], detail: String(error).slice(0, 500) };
      runs.push({ probe: "llm/coverage", categories: ["structure", "quality", "bug"], status: "failed", detail: aiCoverage.detail });
    }
  } else if (options.llmSkippedNote !== undefined) {
    aiCoverage = { status: "disabled", mode: options.diffRef === undefined ? "repository" : "diff", plannedFiles: 0, plannedRanges: [], batches: [], skipped: [], detail: options.llmSkippedNote };
    runs.push({ probe: "llm/judgement", categories: ["structure", "quality", "bug"], status: "skipped", detail: options.llmSkippedNote });
  }

  // The drop is recorded once, after every layer has run, with the true total.
  if (artifactFindings > 0) {
    runs.push({
      probe: "scope",
      categories: ["quality", "security", "secret"],
      status: "ok",
      detail: `${artifactFindings} finding(s) in tooling artifacts (.claude/ and similar) dropped as out of scope`,
    });
  }

  const minRank = severityRank(options.minSeverity ?? "info");
  const wanted = options.categories;
  const kept = findings.filter(
    (finding) =>
      severityRank(finding.severity) <= minRank &&
      (wanted === undefined || wanted.includes(finding.category)),
  );

  const { report } = buildReport({
    tool: { name: "harrier", version: TOOL_VERSION },
    target: { root: options.root },
    startedAt,
    finishedAt: now().toISOString(),
    ...(overview !== undefined ? { overview } : {}),
    probes: runs,
    findings: kept,
  });

  if (aiCoverage) report.aiCoverage = aiCoverage;
  mkdirSync(options.outDir, { recursive: true });
  const paths = {
    json: join(options.outDir, "report.json"),
    sarif: join(options.outDir, "report.sarif"),
    markdown: join(options.outDir, "report.md"),
    html: join(options.outDir, "report.html"),
  };
  writeFileSync(paths.json, renderJson(report));
  writeFileSync(paths.sarif, renderSarif(report));
  writeFileSync(paths.markdown, renderMarkdown(report));
  writeFileSync(paths.html, renderHtml(report));
  return { report, paths };
}
