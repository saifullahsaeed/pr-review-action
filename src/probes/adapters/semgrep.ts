import type { Category, FindingInput, Severity } from "../../findings.ts";
import { runCommand } from "../exec.ts";
import type { Probe, ProbeContext, ProbeOutcome } from "../types.ts";

/**
 * Security patterns — `semgrep scan --json --config <config> <root>`.
 * Output shape (docs.semgrep.dev JSON reference): { version, results[], errors[], paths } with
 * each result carrying check_id, path, start/end {line,col,offset} and extra { message,
 * severity, metadata, lines, fix }.
 */
export interface SemgrepResult {
  check_id: string;
  path: string;
  start: { line: number; col: number };
  end: { line: number; col: number };
  extra?: {
    message?: string;
    severity?: string;
    metadata?: Record<string, unknown>;
    lines?: string;
    fix?: unknown;
  };
}

interface SemgrepOutput {
  results?: SemgrepResult[];
  errors?: unknown[];
}

const SEMGREP_SEVERITY: Record<string, Severity> = {
  ERROR: "high",
  WARNING: "medium",
  INFO: "low",
};

/** semgrep gives a rule id, not a name; the tail of the id is the closest thing it has. */
export function ruleNameFromCheckId(checkId: string): string {
  const tail = checkId.split(".").pop() ?? checkId;
  return tail;
}

export function parseSemgrep(json: string): FindingInput[] {
  const parsed = JSON.parse(json) as SemgrepOutput;
  const results = parsed.results ?? [];
  return results.map((result) => {
    const extra = result.extra ?? {};
    const severity: Severity = SEMGREP_SEVERITY[extra.severity ?? ""] ?? "medium";
    const category: Category = "security";
    const finding: FindingInput = {
      ruleId: `semgrep/${result.check_id}`,
      ruleName: ruleNameFromCheckId(result.check_id),
      category,
      severity,
      message: extra.message ?? `semgrep matched ${result.check_id}.`,
      locations: [
        {
          path: result.path,
          startLine: result.start.line,
          startColumn: result.start.col,
          endLine: result.end.line,
          endColumn: result.end.col,
        },
      ],
      source: "probe",
      probe: "semgrep",
    };
    if (typeof extra.lines === "string" && extra.lines.trim() !== "") finding.evidence = extra.lines;
    if (typeof extra.fix === "string" && extra.fix.trim() !== "") finding.fixHint = extra.fix;
    return finding;
  });
}

export const semgrepProbe: Probe = {
  name: "semgrep",
  categories: ["security"],
  async run(context: ProbeContext): Promise<ProbeOutcome> {
    const probe = "semgrep";
    const config = context.options?.semgrepConfig ?? "auto";
    const outcome = await runCommand(
      ["semgrep", "scan", "--json", "--quiet", "--config", config, context.root],
      { cwd: context.root, timeoutMs: context.timeoutMs },
    );
    if (outcome.kind === "missing") {
      return {
        probe,
        status: "skipped",
        detail: "semgrep is not installed, so no security-pattern rules ran",
        findings: [],
      };
    }
    if (outcome.kind === "failed") {
      return { probe, status: "failed", detail: outcome.detail, findings: [] };
    }
    if (outcome.stdout.trim() === "") {
      return {
        probe,
        status: "failed",
        detail: `semgrep produced no output (exit ${String(outcome.code)}): ${outcome.stderr.slice(0, 200)}`,
        findings: [],
      };
    }
    return { probe, status: "ok", findings: parseSemgrep(outcome.stdout) };
  },
};
