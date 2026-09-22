import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Category, FindingInput, ProbeRun, Report, Severity } from "./findings.ts";
import { severityRank } from "./findings.ts";
import { buildReport } from "./report.ts";
import { renderJson } from "./render/json.ts";
import { renderMarkdown } from "./render/markdown.ts";
import { renderSarif } from "./render/sarif.ts";
import { buildContext } from "./llm/context.ts";
import type { CompleteFn } from "./llm/judgement.ts";
import { runJudgement } from "./llm/judgement.ts";
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
}

export interface ReviewArtifacts {
  report: Report;
  paths: { json: string; sarif: string; markdown: string };
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

  if (options.complete !== undefined) {
    const context = buildContext(options.root);
    const judgement = await runJudgement(options.complete, context, options.passes ?? [
      "structure",
      "quality",
      "bug",
    ]);
    for (const finding of judgement.findings) {
      const path = finding.locations[0]?.path ?? "";
      if (isArtifactPath(path)) {
        artifactFindings += 1;
        continue;
      }
      findings.push(finding);
    }
    for (const status of judgement.passes) {
      const dropped = judgement.dropped.length;
      runs.push({
        probe: `llm/${status.pass}`,
        categories: [CATEGORY_OF_PASS[status.pass]],
        status: status.status === "ok" ? "ok" : "failed",
        ...(status.detail !== undefined ? { detail: status.detail } : {}),
      });
    }
    if (judgement.dropped.length > 0) {
      runs.push({
        probe: "llm/self-check",
        categories: ["quality"],
        status: "ok",
        detail: `${judgement.dropped.length} model finding(s) dropped for carrying no real file and line`,
      });
    }
    overview = judgement.overview;
  } else if (options.llmSkippedNote !== undefined) {
    runs.push({
      probe: "llm/judgement",
      categories: ["structure", "quality", "bug"],
      status: "skipped",
      detail: options.llmSkippedNote,
    });
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

  mkdirSync(options.outDir, { recursive: true });
  const paths = {
    json: join(options.outDir, "report.json"),
    sarif: join(options.outDir, "report.sarif"),
    markdown: join(options.outDir, "report.md"),
  };
  writeFileSync(paths.json, renderJson(report));
  writeFileSync(paths.sarif, renderSarif(report));
  writeFileSync(paths.markdown, renderMarkdown(report));
  return { report, paths };
}
