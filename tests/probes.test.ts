import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { validateFindingInput } from "../src/findings.ts";
import type { FindingInput } from "../src/findings.ts";
import { parseGitleaks } from "../src/probes/adapters/gitleaks.ts";
import { parseSemgrep } from "../src/probes/adapters/semgrep.ts";
import { parseOsVScanner } from "../src/probes/adapters/osvScanner.ts";
import { parseEslint, parseRuff } from "../src/probes/adapters/linters.ts";
import { collectSourceFiles, findCycles, importGraph, metricsFindings, metricsProbe } from "../src/probes/metrics.ts";
import { gitleaksProbe } from "../src/probes/adapters/gitleaks.ts";
import { runProbes } from "../src/probes/run.ts";
import type { Probe } from "../src/probes/types.ts";
import { runCommand } from "../src/probes/exec.ts";

function recorded(name: string): string {
  return readFileSync(new URL(`./fixtures/outputs/${name}`, import.meta.url), "utf8");
}

const plantedRoot = new URL("./fixtures/planted/", import.meta.url).pathname;

function assertModel(findings: FindingInput[]): void {
  for (const finding of findings) {
    assert.deepEqual(validateFindingInput(finding), [], `invalid finding: ${finding.ruleId}`);
  }
}

test("gitleaks output maps to secret findings, with the secret redacted", () => {
  const findings = parseGitleaks(recorded("gitleaks.json"));
  assert.equal(findings.length, 1);
  assertModel(findings);
  const finding = findings[0];
  assert.ok(finding);
  assert.equal(finding.ruleId, "gitleaks/aws-access-key");
  assert.equal(finding.category, "secret");
  assert.equal(finding.severity, "critical");
  assert.equal(finding.locations[0]?.path, "src/config.ts");
  assert.equal(finding.locations[0]?.startLine, 12);
  const serialised = JSON.stringify(finding);
  assert.ok(!serialised.includes("AKIAEXAMPLEKEYEXAMPLEKEY"), "the secret leaked into the report");
  assert.ok(serialised.includes("[redacted]"));
});

test("semgrep output maps to security findings with severity and fix", () => {
  const findings = parseSemgrep(recorded("semgrep.json"));
  assert.equal(findings.length, 1);
  assertModel(findings);
  const finding = findings[0];
  assert.ok(finding);
  assert.equal(finding.ruleId, "semgrep/typescript.lang.security.audit.sqli.tainted-sql-string");
  assert.equal(finding.category, "security");
  assert.equal(finding.severity, "high");
  assert.equal(finding.fixHint, "Use a parameterised query.");
  assert.equal(finding.locations[0]?.startLine, 88);
  assert.equal(finding.locations[0]?.endLine, 92);
});

test("osv-scanner output maps advisories to dependency findings with an upgrade hint", () => {
  const findings = parseOsVScanner(recorded("osv-scanner.json"));
  assert.equal(findings.length, 1);
  assertModel(findings);
  const finding = findings[0];
  assert.ok(finding);
  assert.equal(finding.ruleId, "osv/GHSA-aaaa-bbbb-cccc");
  assert.equal(finding.category, "dependency");
  assert.equal(finding.severity, "high");
  assert.match(finding.message, /CVE-2020-8203/);
  assert.equal(finding.fixHint, "Upgrade lodash to 4.17.21 or later.");
  assert.equal(finding.locations[0]?.path, "package-lock.json");
});

test("eslint output maps to quality findings, and a parse failure is real damage", () => {
  const findings = parseEslint(recorded("eslint.json"));
  assert.equal(findings.length, 3);
  assertModel(findings);
  assert.equal(findings[0]?.severity, "low");
  assert.equal(findings[1]?.severity, "info");
  assert.equal(findings[2]?.ruleId, "eslint/parse-error");
  assert.equal(findings[2]?.severity, "high");
});

test("ruff output maps to quality findings", () => {
  const findings = parseRuff(recorded("ruff.json"));
  assert.equal(findings.length, 1);
  assertModel(findings);
  assert.equal(findings[0]?.ruleId, "ruff/F401");
  assert.equal(findings[0]?.ruleName, "unused-import");
  assert.equal(findings[0]?.fixHint, "Remove unused import: `numpy`");
  assert.equal(findings[0]?.locations[0]?.startLine, 1);
});

test("metrics find the planted duplication and the planted import cycle", () => {
  const files = collectSourceFiles(plantedRoot);
  assert.equal(files.length, 3);
  const findings = metricsFindings(files, {
    longFileLines: 10,
    duplicateLines: 10,
    fanoutLimit: 5,
  });
  assertModel(findings);
  const rules = findings.map((finding) => finding.ruleId).sort();
  assert.ok(rules.includes("metrics/duplicate-block"), "duplication not detected");
  assert.ok(rules.includes("metrics/import-cycle"), "import cycle not detected");
  assert.ok(rules.includes("metrics/long-file"), "file size not measured");

  const cycle = findings.find((finding) => finding.ruleId === "metrics/import-cycle");
  assert.match(cycle?.message ?? "", /src\/a\.ts -> src\/b\.ts -> src\/a\.ts|src\/b\.ts -> src\/a\.ts -> src\/b\.ts/);
  const duplicate = findings.find((finding) => finding.ruleId === "metrics/duplicate-block");
  assert.equal(duplicate?.locations.length, 2);
});

test("import graph resolves relative imports and finds exactly one cycle", () => {
  const files = collectSourceFiles(plantedRoot);
  const graph = importGraph(files);
  assert.deepEqual(graph.get("src/a.ts"), ["src/b.ts"]);
  assert.deepEqual(graph.get("src/b.ts"), ["src/a.ts"]);
  assert.equal(findCycles(graph).length, 1);
});

test("a missing scanner is reported as skipped, not as a clean run", async () => {
  const missing: Probe = {
    name: "definitely-not-installed",
    categories: ["secret"],
    async run() {
      const outcome = await runCommand(["harrier-no-such-tool-xyz", "--version"], {
        cwd: plantedRoot,
        timeoutMs: 5000,
      });
      return {
        probe: "definitely-not-installed",
        status: outcome.kind === "missing" ? "skipped" : "failed",
        detail: outcome.kind === "missing" ? "not installed" : "unexpected",
        findings: [],
      };
    },
  };
  const sweep = await runProbes([missing], { root: plantedRoot, timeoutMs: 5000 });
  assert.equal(sweep.runs[0]?.status, "skipped");
  assert.equal(sweep.runs[0]?.detail, "not installed");
  assert.equal(sweep.findings.length, 0);
});

test("metrics is a probe that runs without any external tool", async () => {
  const { metricsFindings: run } = await import("../src/probes/metrics.ts");
  const findings = run(collectSourceFiles(plantedRoot), {
    longFileLines: 1000,
    duplicateLines: 10,
    fanoutLimit: 50,
  });
  assert.ok(findings.length > 0);
  assert.ok(findings.every((finding) => finding.probe === "metrics"));
});

test("a probe sweep over the planted fixture records what ran and what it found", async () => {
  const sweep = await runProbes([gitleaksProbe, metricsProbe], {
    root: plantedRoot,
    timeoutMs: 5000,
  });
  assert.equal(sweep.runs.length, 2);
  assert.equal(sweep.runs[0]?.probe, "gitleaks");
  assert.ok(
    sweep.runs[0]?.status === "skipped" || sweep.runs[0]?.status === "ok",
    `gitleaks should skip when absent and pass when present, got ${String(sweep.runs[0]?.status)}`,
  );
  assert.equal(sweep.runs[1]?.probe, "metrics");
  assert.equal(sweep.runs[1]?.status, "ok");
  assert.ok(sweep.findings.some((finding) => finding.probe === "metrics"));
  assert.ok(
    sweep.findings.some((finding) => finding.ruleId === "metrics/import-cycle"),
    "the planted import cycle was not found by the sweep",
  );
  assertModel(sweep.findings);
});
