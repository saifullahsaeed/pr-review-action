import type { Finding, Report, Summary } from "../findings.ts";
import { CATEGORIES, SEVERITIES, SOURCES } from "../findings.ts";

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|");
}

function summaryTable(title: string, rows: ReadonlyArray<[string, number]>): string[] {
  const lines = [`| ${title} | Count |`, "| --- | --- |"];
  for (const [label, count] of rows) lines.push(`| ${escapeCell(label)} | ${count} |`);
  return lines;
}

function summaryTables(summary: Summary): string[] {
  return [
    ...summaryTable("Severity", SEVERITIES.map((s) => [s, summary.bySeverity[s]] as [string, number])),
    "",
    ...summaryTable(
      "Category",
      CATEGORIES.map((c) => [c, summary.byCategory[c]] as [string, number]),
    ),
    "",
    ...summaryTable("Source", SOURCES.map((s) => [s, summary.bySource[s]] as [string, number])),
  ];
}

function findingSection(finding: Finding): string[] {
  const first = finding.locations[0];
  const where = first ? `\`${first.path}:${first.startLine}\`` : "`unknown location`";
  const meta: string[] = [];
  if (finding.source === "probe" && finding.probe) meta.push(`_probe:_ \`${finding.probe}\``);
  if (finding.source === "llm" && finding.confidence) {
    meta.push(`_confidence:_ \`${finding.confidence}\``);
  }
  meta.push(`_rule:_ \`${finding.ruleId}\``);

  const lines = [
    `### ${finding.severity} · ${finding.category} · ${where}`,
    "",
    `**${finding.ruleName}** — ${finding.message}`,
    "",
    meta.join(" · "),
  ];
  if (finding.evidence !== undefined && finding.evidence.trim() !== "") {
    lines.push("", "```", finding.evidence, "```");
  }
  if (finding.fixHint !== undefined && finding.fixHint.trim() !== "") {
    lines.push("", `_fix:_ ${finding.fixHint}`);
  }
  if (finding.locations.length > 1) {
    lines.push("", `_also:_ ${finding.locations
      .slice(1)
      .map((location) => `\`${location.path}:${location.startLine}\``)
      .join(", ")}`);
  }
  return lines;
}

export function renderMarkdown(report: Report): string {
  const head = [
    `# Harrier review — \`${report.target.root}\``,
    "",
    `\`${report.startedAt}\` → \`${report.finishedAt}\` · ${
      report.target.commit ? `commit \`${report.target.commit}\` · ` : ""
    }${report.tool.name} ${report.tool.version}`,
    "",
    "## Summary",
    "",
    `**${report.summary.total} finding${report.summary.total === 1 ? "" : "s"}**`,
    "",
    ...summaryTables(report.summary),
  ];

  const body: string[] = [];
  if (report.overview !== undefined && report.overview.trim() !== "") {
    body.push("", "## Overview", "", report.overview);
  }
  body.push("", "## Findings", "");
  if (report.findings.length === 0) {
    body.push("_No findings._");
  } else {
    for (const finding of report.findings) {
      body.push(...findingSection(finding), "");
    }
    body.pop();
  }

  return `${[...head, ...body].join("\n")}\n`;
}
