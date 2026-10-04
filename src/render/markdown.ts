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
  if (report.enforcement) {
    const e = report.enforcement;
    body.push("", "## Project compliance", "", `**${e.status.toUpperCase()}** · ${e.changedFiles.length} files in scope`,
      "", `Trusted policy revision: ${e.policyRevision ?? "explicit local configuration"}`,
      "", "Document compliance is model-reviewed, not deterministic proof; proposals and reference material are not mandatory rules.");
    for (const reason of e.reasons) body.push(`- ${escapeCell(reason)}`);
    for (const r of e.rules) {
      body.push("", `### Rule ${escapeCell(r.ruleId)} — ${r.status} (${r.required ? "required" : "advisory"})`,
        `Source: ${escapeCell(r.source.path)}:${r.source.startLine}; checked files: ${r.checkedFiles.map(escapeCell).join(", ") || "none"}`);
      for (const proof of r.evidence) body.push(`- ${proof.path ? `${escapeCell(proof.path)}:${proof.line ?? "?"}: ` : ""}${escapeCell(proof.detail)}`);
    }
    for (const d of e.documents) {
      body.push("", `### Documents ${escapeCell(d.sourceId)} → ${escapeCell(d.file)} — ${d.status} (${d.required ? "required" : "advisory"})`,
        `Sources: ${d.documents.map(escapeCell).join(", ") || "unavailable"}`, escapeCell(d.detail));
      for (const v of d.violations) body.push(`- ${escapeCell(v.message)}; requirement ${escapeCell(v.requirement.path)}:${v.requirement.line} “${escapeCell(v.requirement.quote)}”; code ${escapeCell(v.code.path)}:${v.code.line} “${escapeCell(v.code.quote)}”; verifier=${v.verified}`);
    }
    if (e.policyChanges.length) body.push("", "Policy/document changes (base requirements remain authoritative):", ...e.policyChanges.map(p => `- ${escapeCell(p)}`));
  }
  if (report.aiCoverage) {
    const c = report.aiCoverage;
    body.push("", "## AI review coverage", "", `**${c.status.toUpperCase()}** · ${c.mode} review · ${c.plannedFiles} planned files · ${c.batches.length} batches`, "", "Coverage describes supplied code and successful requests, not proof that no bugs exist.");
    if (c.detail) body.push("", c.detail);
    for (const b of c.batches) {
      body.push("", `Batch ${b.index}: ${b.passes.map(p => `${p.pass}=${p.status}`).join(", ")}; verifier=${b.verifier}`);
      for (const r of b.ranges) body.push(`- ${escapeCell(r.path)}:${r.startLine}–${r.endLine}`);
      for (const r of b.supportRanges) body.push(`- Support excerpt: ${escapeCell(r.path)}:${r.startLine}–${r.endLine}`);
    }
    if (c.skipped.length) body.push("", "Excluded / unreviewed:", ...c.skipped.map(s => `- ${escapeCell(s.path)}${s.startLine ? `:${s.startLine}–${s.endLine}` : ""}: ${s.reason}`));
  }
  if (report.probes !== undefined && report.probes.length > 0) {
    body.push("", "### Probes", "");
    for (const run of report.probes) {
      body.push(
        `- \`${run.probe}\` (${run.categories.join(", ")}) — **${run.status}**${
          run.detail ? ` — ${run.detail}` : ""
        }`,
      );
    }
  }
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
