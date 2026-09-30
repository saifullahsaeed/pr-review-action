import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Category, FindingInput, ProbeRun, Report, Severity } from "./findings.ts";
import { severityRank } from "./findings.ts";
import { buildReport } from "./report.ts";
import { renderHtml } from "./render/html.ts";
import { renderJson } from "./render/json.ts";
import { renderMarkdown } from "./render/markdown.ts";
import { renderSarif } from "./render/sarif.ts";
import { buildContext } from "./llm/context.ts";
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

  if (options.complete !== undefined) {
    let diffFiles: string[] | undefined;
    if (options.diffRef) {
      try {
        const stdout = execSync(`git diff --name-only ${options.diffRef}`, {
          cwd: options.root,
          encoding: "utf8",
        });
        diffFiles = stdout
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0 && !isArtifactPath(line));
      } catch {
        // Fall back gracefully to full context if git diff fails
      }
    }

    // Smart prioritization: target files changed in diff OR flagged by deterministic probes
    const priorityFiles = new Set<string>();
    if (diffFiles) {
      for (const f of diffFiles) priorityFiles.add(f);
    }
    for (const f of findings) {
      const loc = f.locations?.[0]?.path;
      if (loc && !isArtifactPath(loc)) priorityFiles.add(loc);
    }

    const context = buildContext(options.root, {
      ...(priorityFiles.size > 0 ? { targetFiles: [...priorityFiles] } : {}),
    });

    const priorFindings = findings.map((f) => ({
      ruleName: f.ruleName,
      category: f.category,
      severity: f.severity,
      message: f.message,
      path: f.locations?.[0]?.path,
      line: f.locations?.[0]?.startLine,
    }));

    const judgement = await runJudgement(
      options.complete,
      context,
      options.passes ?? ["structure", "quality", "bug"],
      priorFindings,
    );
    const candidateLlmFindings: FindingInput[] = [];
    for (const finding of judgement.findings) {
      const path = finding.locations[0]?.path ?? "";
      if (isArtifactPath(path)) {
        artifactFindings += 1;
        continue;
      }
      candidateLlmFindings.push(finding);
    }

    // Second-pass Adversarial Verifier: filter hallucinations and weak findings
    const verifiedResult = await verifyCandidateFindings(
      options.complete,
      context,
      candidateLlmFindings
    );

    for (const finding of verifiedResult.verified) {
      findings.push(finding);
    }

    if (verifiedResult.dropped.length > 0) {
      runs.push({
        probe: "llm/verifier",
        categories: ["bug", "quality", "structure"],
        status: "ok",
        detail: `Verified and dropped ${verifiedResult.dropped.length} hallucinated or unverified finding(s)`,
      });
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
    html: join(options.outDir, "report.html"),
  };
  writeFileSync(paths.json, renderJson(report));
  writeFileSync(paths.sarif, renderSarif(report));
  writeFileSync(paths.markdown, renderMarkdown(report));
  writeFileSync(paths.html, renderHtml(report));
  return { report, paths };
}
