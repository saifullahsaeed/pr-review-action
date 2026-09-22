import assert from "node:assert/strict";
import { test } from "node:test";
import type { FindingInput } from "../src/findings.ts";
import { computeFingerprint, normalizeFinding, validateFindingInput } from "../src/findings.ts";
import { buildReport, canonicalJson, collectFindings, summarize } from "../src/report.ts";
import { fixtureFindings, fixtureReport } from "./fixtures.ts";

function input(overrides: Partial<FindingInput> = {}): FindingInput {
  return {
    ruleId: "test/rule",
    ruleName: "Test rule",
    category: "quality",
    severity: "low",
    message: "Something worth reporting.",
    locations: [{ path: "src/a.ts", startLine: 1 }],
    source: "probe",
    probe: "test",
    ...overrides,
  };
}

test("validate rejects a finding with no locations", () => {
  const problems = validateFindingInput(input({ locations: [] }));
  assert.ok(problems.some((p) => p.includes("at least one location")));
});

test("validate requires the probe name for probe findings", () => {
  const problems = validateFindingInput(input({ probe: undefined }));
  assert.ok(problems.some((p) => p.includes("probe is required")));
});

test("normalizeFinding drops invalid input instead of shipping it", () => {
  assert.equal(normalizeFinding(input({ locations: [] })), null);
  assert.equal(normalizeFinding(input({ severity: "catestrophic" as never })), null);
  assert.notEqual(normalizeFinding(input()), null);
});

test("normalizeFinding computes id and fingerprint when the producer omits them", () => {
  const finding = normalizeFinding(input());
  assert.ok(finding);
  assert.equal(finding.id, finding.fingerprint);
  assert.equal(
    finding.fingerprint,
    computeFingerprint("test/rule", "Something worth reporting.", "src/a.ts", 1),
  );
});

test("collectFindings separates dropped and duplicates", () => {
  const collected = collectFindings([
    input(),
    input(), // exact duplicate
    input({ locations: [] }), // invalid
    input({ message: "Different message." }),
  ]);
  assert.equal(collected.findings.length, 2);
  assert.equal(collected.duplicates, 1);
  assert.equal(collected.dropped.length, 1);
});

test("summarize counts every severity, category and source", () => {
  const summary = summarize(fixtureReport().findings);
  assert.equal(summary.total, 8);
  assert.equal(summary.bySeverity.critical, 2);
  assert.equal(summary.bySeverity.high, 2);
  assert.equal(summary.bySeverity.medium, 2);
  assert.equal(summary.bySeverity.low, 1);
  assert.equal(summary.bySeverity.info, 1);
  assert.equal(summary.bySource.probe, 5);
  assert.equal(summary.bySource.llm, 3);
  assert.equal(summary.byCategory.structure, 2);
});

test("findings are sorted severity-first and stable across runs", () => {
  const golden = fixtureReport();
  const { report } = buildReport({
    tool: golden.tool,
    target: golden.target,
    startedAt: golden.startedAt,
    finishedAt: golden.finishedAt,
    overview: golden.overview,
    probes: golden.probes,
    findings: [...fixtureFindings()].reverse(),
  });
  assert.deepEqual(
    report.findings.map((f) => f.severity),
    ["critical", "critical", "high", "high", "medium", "medium", "low", "info"],
  );
  assert.equal(canonicalJson(report), canonicalJson(golden));
});

test("canonical JSON round-trips byte-stable", () => {
  const once = canonicalJson(fixtureReport());
  const parsed = JSON.parse(once) as Parameters<typeof canonicalJson>[0];
  assert.equal(canonicalJson(parsed), once);
});
