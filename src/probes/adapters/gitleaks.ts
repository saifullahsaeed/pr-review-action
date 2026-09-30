import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FindingInput } from "../../findings.ts";
import { runCommand } from "../exec.ts";
import type { Probe, ProbeContext, ProbeOutcome } from "../types.ts";

/**
 * Secrets — `gitleaks dir --report-format json --report-path <file> <root>`.
 * Output shape (gitleaks v8, from report/json.go + report/finding.go): a bare JSON array of
 * findings with PascalCase fields.
 *
 * The secret itself is never written into the report: a findings file is a thing that gets
 * pasted into tickets, and a report that carries live credentials is a leak with a cover page.
 */
export interface GitleaksFinding {
  RuleID: string;
  Description?: string;
  StartLine: number;
  EndLine?: number;
  StartColumn?: number;
  EndColumn?: number;
  Match?: string;
  Secret?: string;
  File: string;
  Tags?: string[];
}

const REDACTED = "[redacted]";

export function redactSecret(text: string | undefined, secret: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  if (secret === undefined || secret === "") return text;
  return text.split(secret).join(REDACTED);
}

export function parseGitleaks(json: string): FindingInput[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw new Error("gitleaks output is not a JSON array");
  }
  return parsed.map((raw) => {
    const item = raw as GitleaksFinding;
    const name = item.Description ?? item.RuleID;
    const finding: FindingInput = {
      ruleId: `gitleaks/${item.RuleID}`,
      ruleName: name,
      category: "secret",
      severity: "critical",
      message: `${name} found in ${item.File}.`,
      locations: [
        {
          path: item.File,
          startLine: item.StartLine,
          ...(item.StartColumn !== undefined ? { startColumn: item.StartColumn } : {}),
          ...(item.EndLine !== undefined ? { endLine: item.EndLine } : {}),
          ...(item.EndColumn !== undefined ? { endColumn: item.EndColumn } : {}),
        },
      ],
      source: "probe",
      probe: "gitleaks",
      fixHint: "Rotate the credential and remove it from the repository history.",
    };
    const evidence = redactSecret(item.Match, item.Secret);
    if (evidence !== undefined) finding.evidence = evidence;
    return finding;
  });
}

export const gitleaksProbe: Probe = {
  name: "gitleaks",
  categories: ["secret"],
  async run(context: ProbeContext): Promise<ProbeOutcome> {
    const probe = "gitleaks";
    const scratch = mkdtempSync(join(tmpdir(), "harrier-gitleaks-"));
    const reportPath = join(scratch, "gitleaks.json");
    try {
      // Try `gitleaks dir` (newer versions) or fallback to `gitleaks detect --no-git --source`
      let outcome = await runCommand(
        ["gitleaks", "dir", "--report-format", "json", "--report-path", reportPath, context.root],
        { cwd: context.root, timeoutMs: context.timeoutMs },
      );
      if (outcome.kind === "failed" || (outcome.kind === "ok" && !existsSync(reportPath))) {
        outcome = await runCommand(
          ["gitleaks", "detect", "--no-git", "--source", context.root, "--report-format", "json", "--report-path", reportPath],
          { cwd: context.root, timeoutMs: context.timeoutMs },
        );
      }
      if (outcome.kind === "missing") {
        return {
          probe,
          status: "skipped",
          detail: "gitleaks is not installed, so nothing was checked for secrets",
          findings: [],
        };
      }
      if (outcome.kind === "failed") {
        return { probe, status: "failed", detail: outcome.detail, findings: [] };
      }
      let report: string;
      try {
        report = readFileSync(reportPath, "utf8");
      } catch {
        return {
          probe,
          status: "failed",
          detail: `gitleaks produced no report (exit ${String(outcome.code)}): ${outcome.stderr.slice(0, 200)}`,
          findings: [],
        };
      }
      return { probe, status: "ok", findings: parseGitleaks(report) };
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  },
};
