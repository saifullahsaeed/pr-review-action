import type { FindingInput, Severity } from "../../findings.ts";
import { runCommand } from "../exec.ts";
import type { Probe, ProbeContext, ProbeOutcome } from "../types.ts";

/**
 * Mechanical quality — the language's own linter, wired for JS/TS (eslint) and Python (ruff).
 * ESLint output shape (eslint.org formatters docs): [{ filePath, messages: [{ ruleId, severity
 * 1|2, message, line, column, endLine, endColumn, fatal?, fix?, suggestions? }] }].
 * Ruff output shape (astral-sh/ruff json renderer): a bare array of { code, name, severity,
 * message, filename, location{row,column}, end_location{row,column}, fix }.
 *
 * Severity stays low by design: a linter complaint is a quality note, not a security finding.
 * A file that fails to parse is the exception — that one is real damage.
 */

export interface EslintMessage {
  ruleId: string | null;
  severity: number;
  message: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  fatal?: boolean;
  fix?: unknown;
  suggestions?: Array<{ desc?: string }>;
}

export interface EslintFileResult {
  filePath: string;
  messages: EslintMessage[];
}

export interface RuffDiagnostic {
  code: string | null;
  name?: string;
  severity?: string;
  message: string;
  filename: string;
  location: { row: number; column: number };
  end_location?: { row: number; column: number };
  fix?: { message?: string } | null;
}

export function parseEslint(json: string): FindingInput[] {
  const parsed = JSON.parse(json) as EslintFileResult[];
  const findings: FindingInput[] = [];
  for (const file of parsed) {
    for (const message of file.messages) {
      const severity: Severity = message.fatal === true ? "high" : message.severity === 2 ? "low" : "info";
      const ruleId = message.ruleId ?? "parse-error";
      const finding: FindingInput = {
        ruleId: `eslint/${ruleId}`,
        ruleName: ruleId,
        category: "quality",
        severity,
        message: message.message,
        locations: [
          {
            path: file.filePath,
            startLine: message.line ?? 1,
            ...(message.column !== undefined ? { startColumn: message.column } : {}),
            ...(message.endLine !== undefined ? { endLine: message.endLine } : {}),
            ...(message.endColumn !== undefined ? { endColumn: message.endColumn } : {}),
          },
        ],
        source: "probe",
        probe: "eslint",
      };
      const suggestion = message.suggestions?.[0]?.desc;
      if (suggestion !== undefined && suggestion.trim() !== "") finding.fixHint = suggestion;
      findings.push(finding);
    }
  }
  return findings;
}

export function parseRuff(json: string): FindingInput[] {
  const parsed = JSON.parse(json) as RuffDiagnostic[];
  return parsed.map((diagnostic) => {
    const code = diagnostic.code ?? "unclassified";
    const finding: FindingInput = {
      ruleId: `ruff/${code}`,
      ruleName: diagnostic.name ?? code,
      category: "quality",
      severity: "low",
      message: diagnostic.message,
      locations: [
        {
          path: diagnostic.filename,
          startLine: diagnostic.location.row,
          startColumn: diagnostic.location.column,
          ...(diagnostic.end_location !== undefined ? { endLine: diagnostic.end_location.row } : {}),
          ...(diagnostic.end_location !== undefined
            ? { endColumn: diagnostic.end_location.column }
            : {}),
        },
      ],
      source: "probe",
      probe: "ruff",
    };
    const fix = diagnostic.fix?.message;
    if (fix !== undefined && fix.trim() !== "") finding.fixHint = fix;
    return finding;
  });
}

export const eslintProbe: Probe = {
  name: "eslint",
  categories: ["quality"],
  async run(context: ProbeContext): Promise<ProbeOutcome> {
    const probe = "eslint";
    const outcome = await runCommand(["eslint", "--format", "json", context.root], {
      cwd: context.root,
      timeoutMs: context.timeoutMs,
    });
    if (outcome.kind === "missing") {
      return {
        probe,
        status: "skipped",
        detail: "eslint is not installed, so no JS/TS lint rules ran",
        findings: [],
      };
    }
    if (outcome.kind === "failed") {
      return { probe, status: "failed", detail: outcome.detail, findings: [] };
    }
    // eslint exits 1 when there are findings or when a file fails to parse; its JSON is still good.
    const start = outcome.stdout.indexOf("[");
    if (start < 0) {
      // eslint with no configuration in the repo is a gap to report, not a failure.
      const noConfig = /config/i.test(outcome.stderr);
      return {
        probe,
        status: noConfig ? "skipped" : "failed",
        detail: noConfig
          ? "eslint found no configuration in this repo, so no JS/TS lint rules ran"
          : `eslint produced no parseable JSON (exit ${String(outcome.code)}): ${outcome.stderr.slice(0, 200)}`,
        findings: [],
      };
    }
    return { probe, status: "ok", findings: parseEslint(outcome.stdout.slice(start)) };
  },
};

export const ruffProbe: Probe = {
  name: "ruff",
  categories: ["quality"],
  async run(context: ProbeContext): Promise<ProbeOutcome> {
    const probe = "ruff";
    const outcome = await runCommand(["ruff", "check", "--output-format", "json", context.root], {
      cwd: context.root,
      timeoutMs: context.timeoutMs,
    });
    if (outcome.kind === "missing") {
      return {
        probe,
        status: "skipped",
        detail: "ruff is not installed, so no Python lint rules ran",
        findings: [],
      };
    }
    if (outcome.kind === "failed") {
      return { probe, status: "failed", detail: outcome.detail, findings: [] };
    }
    const start = outcome.stdout.indexOf("[");
    if (start < 0) {
      return {
        probe,
        status: "failed",
        detail: `ruff produced no parseable JSON (exit ${String(outcome.code)}): ${outcome.stderr.slice(0, 200)}`,
        findings: [],
      };
    }
    return { probe, status: "ok", findings: parseRuff(outcome.stdout.slice(start)) };
  },
};
