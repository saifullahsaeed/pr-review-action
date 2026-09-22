import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { sarifLevel, renderSarif, sarifLog } from "../src/render/sarif.ts";
import { fixtureReport } from "./fixtures.ts";

test("severity maps onto SARIF levels", () => {
  assert.equal(sarifLevel("critical"), "error");
  assert.equal(sarifLevel("high"), "error");
  assert.equal(sarifLevel("medium"), "warning");
  assert.equal(sarifLevel("low"), "note");
  assert.equal(sarifLevel("info"), "note");
});

test("SARIF log has the 2.1.0 shape", () => {
  const log = sarifLog(fixtureReport()) as {
    version: string;
    runs: Array<{
      tool: { driver: { name: string; rules: unknown[] } };
      results: Array<{ ruleId: string; level: string; locations: unknown[] }>;
    }>;
  };
  assert.equal(log.version, "2.1.0");
  const run = log.runs[0];
  assert.ok(run);
  assert.equal(run.tool.driver.name, "Harrier");
  assert.equal(run.results.length, 8);
  assert.equal(run.tool.driver.rules.length, 8);
  assert.equal(run.results[0]?.level, "error");
  assert.ok((run.results[0]?.locations?.length ?? 0) >= 1);
});

test("SARIF rendering matches the golden file", () => {
  const golden = readFileSync(new URL("./golden/report.sarif.json", import.meta.url), "utf8");
  assert.equal(renderSarif(fixtureReport()), golden);
});
