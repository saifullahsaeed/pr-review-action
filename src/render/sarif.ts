import type { Finding, Report, Severity } from "../findings.ts";

/**
 * SARIF 2.1.0 rendering — the interchange format GitHub code scanning, VS Code and
 * every serious review surface already understand.
 */

const SARIF_LEVELS = ["none", "note", "warning", "error"] as const;
export type SarifLevel = (typeof SARIF_LEVELS)[number];

export function sarifLevel(severity: Severity): SarifLevel {
  switch (severity) {
    case "critical":
    case "high":
      return "error";
    case "medium":
      return "warning";
    case "low":
    case "info":
      return "note";
  }
}

function sarifLocation(location: Finding["locations"][number]): Record<string, unknown> {
  const region: Record<string, unknown> = { startLine: location.startLine };
  if (location.startColumn !== undefined) region.startColumn = location.startColumn;
  if (location.endLine !== undefined) region.endLine = location.endLine;
  if (location.endColumn !== undefined) region.endColumn = location.endColumn;
  return {
    physicalLocation: {
      artifactLocation: { uri: location.path },
      region,
    },
  };
}

function sarifResult(finding: Finding, ruleIndex: number): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    category: finding.category,
    source: finding.source,
  };
  if (finding.probe !== undefined) properties.probe = finding.probe;
  if (finding.confidence !== undefined) properties.confidence = finding.confidence;
  const result: Record<string, unknown> = {
    ruleId: finding.ruleId,
    ruleIndex,
    level: sarifLevel(finding.severity),
    message: { text: finding.message },
    locations: finding.locations.map(sarifLocation),
    partialFingerprints: {
      "harrierFingerprint/v1": finding.fingerprint,
    },
    properties,
  };
  if (finding.fixHint !== undefined) {
    result.fixes = [
      {
        description: { text: finding.fixHint },
      },
    ];
  }
  return result;
}

export function sarifLog(report: Report): Record<string, unknown> {
  const ruleIds = [...new Set(report.findings.map((f) => f.ruleId))].sort();
  const ruleIndex = new Map(ruleIds.map((id, index) => [id, index]));
  const ruleNameById = new Map(report.findings.map((f) => [f.ruleId, f.ruleName]));

  const rules = ruleIds.map((id) => ({
    id,
    name: id,
    shortDescription: { text: ruleNameById.get(id) ?? id },
    defaultConfiguration: {
      level: sarifLevel(
        report.findings.find((f) => f.ruleId === id)?.severity ?? "info",
      ),
    },
  }));

  const results = report.findings.map((finding) =>
    sarifResult(finding, ruleIndex.get(finding.ruleId) ?? 0),
  );

  const run: Record<string, unknown> = {
    tool: {
      driver: {
        name: "Harrier",
        version: report.tool.version,
        rules,
      },
    },
    automationDetails: { id: "harrier/review/1.0.0" },
    invocations: [
      {
        executionSuccessful: true,
        startTimeUtc: report.startedAt,
        endTimeUtc: report.finishedAt,
      },
    ],
    originalUriBaseIds: {
      SRCROOT: {
        uri: `file://${report.target.root.endsWith("/") ? report.target.root : `${report.target.root}/`}`,
      },
    },
    results,
  };
  const properties: Record<string, unknown> = {};
  if (report.overview !== undefined) properties.overview = report.overview;
  if (report.probes !== undefined) properties.probes = report.probes;
  if (Object.keys(properties).length > 0) run.properties = properties;

  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [run],
  };
}

export function renderSarif(report: Report): string {
  return `${JSON.stringify(sarifLog(report), null, 2)}\n`;
}
