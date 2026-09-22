import type { FindingInput, Severity } from "../../findings.ts";
import { runCommand } from "../exec.ts";
import type { Probe, ProbeContext, ProbeOutcome } from "../types.ts";

/**
 * Dependency advisories — `osv-scanner scan --format json --recursive <root>` (osv-scanner v2/v3).
 * Output shape (google.github.io/osv-scanner/output/): { results: [{ source, packages:
 * [{ package, vulnerabilities: [OSV record], groups }] }] }, where each vulnerability is a full
 * OSV record.
 *
 * Two honest limits: severity comes from `database_specific.severity` when the advisory has one
 * (the GHSA convention) and is otherwise assumed high, because parsing a CVSS vector to a score
 * is a project of its own; and the location is the lockfile as a whole, not the line the package
 * sits on.
 */
export interface OsVulnerability {
  id: string;
  aliases?: string[];
  summary?: string;
  database_specific?: { severity?: string };
  affected?: Array<{
    ranges?: Array<{ events?: Array<{ introduced?: string; fixed?: string }> }>;
  }>;
}

export interface OsVOutput {
  results?: Array<{
    source?: { path?: string };
    packages?: Array<{
      package?: { name?: string; version?: string };
      vulnerabilities?: OsVulnerability[];
    }>;
  }>;
}

const OSV_SEVERITY: Record<string, Severity> = {
  CRITICAL: "critical",
  HIGH: "high",
  MODERATE: "medium",
  MEDIUM: "medium",
  LOW: "low",
};

export function fixedVersionOf(vulnerability: OsVulnerability): string | undefined {
  for (const affected of vulnerability.affected ?? []) {
    for (const range of affected.ranges ?? []) {
      for (const event of range.events ?? []) {
        if (event.fixed !== undefined && event.fixed !== "") return event.fixed;
      }
    }
  }
  return undefined;
}

export function parseOsVScanner(json: string): FindingInput[] {
  const parsed = JSON.parse(json) as OsVOutput;
  const findings: FindingInput[] = [];
  for (const result of parsed.results ?? []) {
    const lockfilePath = result.source?.path ?? "dependency manifest";
    for (const entry of result.packages ?? []) {
      const name = entry.package?.name ?? "unknown package";
      const version = entry.package?.version ?? "unknown version";
      for (const vulnerability of entry.vulnerabilities ?? []) {
        const aliases = vulnerability.aliases ?? [];
        const fixed = fixedVersionOf(vulnerability);
        const finding: FindingInput = {
          ruleId: `osv/${vulnerability.id}`,
          ruleName: "Dependency with known vulnerability",
          category: "dependency",
          severity: OSV_SEVERITY[vulnerability.database_specific?.severity ?? ""] ?? "high",
          message:
            `${name}@${version} is affected by ${vulnerability.id}` +
            (aliases.length > 0 ? ` (${aliases.join(", ")})` : "") +
            `: ${vulnerability.summary ?? "no summary in the advisory"}.`,
          locations: [{ path: lockfilePath, startLine: 1 }],
          source: "probe",
          probe: "osv-scanner",
          evidence: `${name}@${version}`,
          fixHint:
            fixed !== undefined
              ? `Upgrade ${name} to ${fixed} or later.`
              : "Check the advisory for a fixed version.",
        };
        findings.push(finding);
      }
    }
  }
  return findings;
}

export const osvScannerProbe: Probe = {
  name: "osv-scanner",
  categories: ["dependency"],
  async run(context: ProbeContext): Promise<ProbeOutcome> {
    const probe = "osv-scanner";
    const outcome = await runCommand(
      ["osv-scanner", "scan", "--format", "json", "--recursive", context.root],
      { cwd: context.root, timeoutMs: context.timeoutMs },
    );
    if (outcome.kind === "missing") {
      return {
        probe,
        status: "skipped",
        detail: "osv-scanner is not installed, so dependencies were not checked against advisories",
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
        detail: `osv-scanner produced no output (exit ${String(outcome.code)}): ${outcome.stderr.slice(0, 200)}`,
        findings: [],
      };
    }
    return { probe, status: "ok", findings: parseOsVScanner(outcome.stdout) };
  },
};
