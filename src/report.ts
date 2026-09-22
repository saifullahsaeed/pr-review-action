import type {
  Category,
  Finding,
  FindingInput,
  Report,
  Severity,
  Source,
  Summary,
  TargetInfo,
  ToolInfo,
} from "./findings.ts";
import {
  CATEGORIES,
  SEVERITIES,
  SOURCES,
  normalizeFinding,
  sortFindings,
} from "./findings.ts";

export interface Collected {
  findings: Finding[];
  /** Invalid input — dropped by the self-check rather than shipped as a broken finding. */
  dropped: FindingInput[];
  /** Valid but identical to something already kept (same fingerprint). */
  duplicates: number;
}

export function collectFindings(inputs: readonly FindingInput[]): Collected {
  const kept: Finding[] = [];
  const dropped: FindingInput[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  for (const input of inputs) {
    const finding = normalizeFinding(input);
    if (!finding) {
      dropped.push(input);
      continue;
    }
    if (seen.has(finding.fingerprint)) {
      duplicates += 1;
      continue;
    }
    seen.add(finding.fingerprint);
    kept.push(finding);
  }
  return { findings: sortFindings(kept), dropped, duplicates };
}

export function summarize(findings: readonly Finding[]): Summary {
  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<Severity, number>;
  const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
  const bySource = Object.fromEntries(SOURCES.map((s) => [s, 0])) as Record<Source, number>;
  for (const finding of findings) {
    bySeverity[finding.severity] += 1;
    byCategory[finding.category] += 1;
    bySource[finding.source] += 1;
  }
  return { total: findings.length, bySeverity, byCategory, bySource };
}

export function buildReport(input: {
  tool: ToolInfo;
  target: TargetInfo;
  startedAt: string;
  finishedAt: string;
  overview?: string;
  findings: readonly FindingInput[];
}): { report: Report; collected: Collected } {
  const collected = collectFindings(input.findings);
  const report: Report = {
    schemaVersion: "1.0.0",
    tool: input.tool,
    target: input.target,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    ...(input.overview !== undefined && input.overview.trim() !== ""
      ? { overview: input.overview }
      : {}),
    summary: summarize(collected.findings),
    findings: collected.findings,
  };
  return { report, collected };
}

/* --------------------------------------------------------------------------
 * Canonical JSON — the machine-readable report ("the thing you feed to an AI").
 * Field order is fixed and findings are pre-sorted, so the bytes are stable
 * across runs and machines.
 * -------------------------------------------------------------------------- */

function jsonLocation(location: Finding["locations"][number]): Record<string, unknown> {
  const out: Record<string, unknown> = {
    path: location.path,
    startLine: location.startLine,
  };
  if (location.startColumn !== undefined) out.startColumn = location.startColumn;
  if (location.endLine !== undefined) out.endLine = location.endLine;
  if (location.endColumn !== undefined) out.endColumn = location.endColumn;
  return out;
}

function jsonFinding(finding: Finding): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: finding.id,
    ruleId: finding.ruleId,
    ruleName: finding.ruleName,
    category: finding.category,
    severity: finding.severity,
    message: finding.message,
    locations: finding.locations.map(jsonLocation),
    source: finding.source,
  };
  if (finding.probe !== undefined) out.probe = finding.probe;
  if (finding.confidence !== undefined) out.confidence = finding.confidence;
  if (finding.evidence !== undefined) out.evidence = finding.evidence;
  if (finding.fixHint !== undefined) out.fixHint = finding.fixHint;
  out.fingerprint = finding.fingerprint;
  return out;
}

function jsonSummary(summary: Summary): Record<string, unknown> {
  return {
    total: summary.total,
    bySeverity: Object.fromEntries(SEVERITIES.map((s) => [s, summary.bySeverity[s]])),
    byCategory: Object.fromEntries(CATEGORIES.map((c) => [c, summary.byCategory[c]])),
    bySource: Object.fromEntries(SOURCES.map((s) => [s, summary.bySource[s]])),
  };
}

export function jsonReport(report: Report): Record<string, unknown> {
  const out: Record<string, unknown> = {
    schemaVersion: report.schemaVersion,
    tool: { name: report.tool.name, version: report.tool.version },
    target: report.target.commit
      ? { root: report.target.root, commit: report.target.commit }
      : { root: report.target.root },
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
  };
  if (report.overview !== undefined) out.overview = report.overview;
  out.summary = jsonSummary(report.summary);
  out.findings = report.findings.map(jsonFinding);
  return out;
}

export function canonicalJson(report: Report): string {
  return `${JSON.stringify(jsonReport(report), null, 2)}\n`;
}
