import { createHash } from "node:crypto";

/** The one findings model. Every layer of Harrier — probes, LLM passes, renderers — speaks this. */

export const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const CATEGORIES = [
  "dependency",
  "secret",
  "security",
  "quality",
  "structure",
  "bug",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const SOURCES = ["probe", "llm"] as const;
export type Source = (typeof SOURCES)[number];

export const CONFIDENCES = ["high", "medium", "low"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export interface Location {
  path: string;
  startLine: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
}

export interface Finding {
  id: string;
  ruleId: string;
  ruleName: string;
  category: Category;
  severity: Severity;
  message: string;
  locations: Location[];
  source: Source;
  /** Which deterministic tool found it. Required when source is "probe". */
  probe?: string;
  /** How sure the model is. Meaningful when source is "llm". */
  confidence?: Confidence;
  /** The code or output that proves the finding. */
  evidence?: string;
  fixHint?: string;
  fingerprint: string;
}

/** What a producer hands over: identity is computed here, not by the producer. */
export type FindingInput = Omit<Finding, "id" | "fingerprint"> & {
  id?: string;
  fingerprint?: string;
};

export interface Summary {
  total: number;
  bySeverity: Record<Severity, number>;
  byCategory: Record<Category, number>;
  bySource: Record<Source, number>;
}

export interface ToolInfo {
  name: string;
  version: string;
}

export interface TargetInfo {
  root: string;
  commit?: string;
}

export type ProbeStatus = "ok" | "skipped" | "failed";

/**
 * What Harrier actually ran. A report that says "clean" without this is not to be trusted:
 * a no-secrets result means nothing if gitleaks never ran.
 */
export interface ProbeRun {
  probe: string;
  categories: Category[];
  status: ProbeStatus;
  detail?: string;
}

export interface Report {
  schemaVersion: "1.0.0";
  tool: ToolInfo;
  target: TargetInfo;
  startedAt: string;
  finishedAt: string;
  overview?: string;
  probes?: ProbeRun[];
  summary: Summary;
  findings: Finding[];
}

/**
 * Stable identity for a finding across runs. Line numbers are in the basis on purpose:
 * a finding that moves is treated as new rather than deduped into silence.
 */
export function computeFingerprint(
  ruleId: string,
  message: string,
  path: string,
  startLine: number,
): string {
  const normalisedMessage = message.trim().toLowerCase().replace(/\s+/g, " ");
  const basis = `${ruleId}\n${path}\n${startLine}\n${normalisedMessage}`;
  return createHash("sha256").update(basis).digest("hex").slice(0, 16);
}

export function validateFindingInput(input: FindingInput): string[] {
  const problems: string[] = [];
  const isOneOf = (value: string, allowed: readonly string[]): boolean =>
    (allowed as readonly string[]).includes(value);

  if (!input.ruleId?.trim()) problems.push("ruleId is required");
  if (!input.ruleName?.trim()) problems.push("ruleName is required");
  if (!input.message?.trim()) problems.push("message is required");
  if (!isOneOf(input.severity, SEVERITIES)) {
    problems.push(`severity must be one of: ${SEVERITIES.join(", ")}`);
  }
  if (!isOneOf(input.category, CATEGORIES)) {
    problems.push(`category must be one of: ${CATEGORIES.join(", ")}`);
  }
  if (!isOneOf(input.source, SOURCES)) {
    problems.push(`source must be one of: ${SOURCES.join(", ")}`);
  }
  if (input.source === "probe" && !input.probe?.trim()) {
    problems.push("probe is required when source is \"probe\"");
  }
  if (input.confidence !== undefined && !isOneOf(input.confidence, CONFIDENCES)) {
    problems.push(`confidence must be one of: ${CONFIDENCES.join(", ")}`);
  }
  if (!Array.isArray(input.locations) || input.locations.length === 0) {
    problems.push("at least one location is required");
  } else {
    input.locations.forEach((location, index) => {
      if (!location?.path?.trim()) problems.push(`locations[${index}].path is required`);
      if (!(typeof location?.startLine === "number" && location.startLine >= 1)) {
        problems.push(`locations[${index}].startLine must be a positive line number`);
      }
    });
  }
  return problems;
}

/** Valid input becomes a Finding; anything else becomes null — the self-check that drops junk. */
export function normalizeFinding(input: FindingInput): Finding | null {
  if (validateFindingInput(input).length > 0) return null;
  const first = input.locations[0] as Location;
  const fingerprint =
    input.fingerprint ?? computeFingerprint(input.ruleId, input.message, first.path, first.startLine);
  const finding: Finding = {
    id: input.id ?? fingerprint,
    ruleId: input.ruleId,
    ruleName: input.ruleName,
    category: input.category,
    severity: input.severity,
    message: input.message,
    locations: input.locations.map((location) => ({ ...location })),
    source: input.source,
    fingerprint,
  };
  if (input.probe !== undefined) finding.probe = input.probe;
  if (input.confidence !== undefined) finding.confidence = input.confidence;
  if (input.evidence !== undefined) finding.evidence = input.evidence;
  if (input.fixHint !== undefined) finding.fixHint = input.fixHint;
  return finding;
}

export function severityRank(severity: Severity): number {
  return SEVERITIES.indexOf(severity);
}

/** Severity first, then path, line and rule — so two runs over one repo print identically. */
export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const bySeverity = severityRank(a.severity) - severityRank(b.severity);
    if (bySeverity !== 0) return bySeverity;
    const pathA = a.locations[0]?.path ?? "";
    const pathB = b.locations[0]?.path ?? "";
    if (pathA !== pathB) return pathA < pathB ? -1 : 1;
    const lineA = a.locations[0]?.startLine ?? 0;
    const lineB = b.locations[0]?.startLine ?? 0;
    if (lineA !== lineB) return lineA - lineB;
    if (a.ruleId !== b.ruleId) return a.ruleId < b.ruleId ? -1 : 1;
    return a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0;
  });
}
