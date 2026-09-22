import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseReviewArgs } from "../src/args.ts";
import { review } from "../src/pipeline.ts";
import { metricsProbe } from "../src/probes/metrics.ts";
import type { ChatMessage } from "../src/llm/client.ts";

const plantedRoot = new URL("./fixtures/planted/", import.meta.url).pathname;
const fixedNow = (): Date => new Date("2026-09-22T10:00:00.000Z");

function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "harrier-review-"));
  return run(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test("a review writes all three report files and records what ran", async () => {
  await withTempDir(async (outDir) => {
    const artifacts = await review({
      root: plantedRoot,
      outDir,
      probes: [metricsProbe],
      now: fixedNow,
    });
    for (const path of [artifacts.paths.json, artifacts.paths.sarif, artifacts.paths.markdown]) {
      assert.ok(readFileSync(path, "utf8").length > 0, `${path} is empty`);
    }
    const parsed = JSON.parse(readFileSync(artifacts.paths.json, "utf8")) as {
      schemaVersion: string;
      probes: Array<{ probe: string; status: string }>;
      findings: Array<{ ruleId: string }>;
    };
    assert.equal(parsed.schemaVersion, "1.0.0");
    assert.deepEqual(parsed.probes.map((run) => run.probe), ["metrics"]);
    assert.ok(parsed.findings.some((finding) => finding.ruleId === "metrics/import-cycle"));
  });
});

test("category and severity filters shape the report before it is rendered", async () => {
  await withTempDir(async (outDir) => {
    const artifacts = await review({
      root: plantedRoot,
      outDir,
      probes: [metricsProbe],
      categories: ["structure"],
      minSeverity: "medium",
      now: fixedNow,
    });
    const rules = artifacts.report.findings.map((finding) => finding.ruleId);
    assert.ok(rules.includes("metrics/import-cycle"));
    assert.ok(!rules.includes("metrics/long-file"), "info findings must be filtered out");
    assert.ok(!rules.includes("metrics/duplicate-block"), "quality must be filtered out");
  });
});

test("judgement passes run through the injected endpoint and land in probes[]", async () => {
  await withTempDir(async (outDir) => {
    const calls: ChatMessage[][] = [];
    const stub = async (messages: ChatMessage[]): Promise<{ content: string; model: string }> => {
      calls.push(messages);
      return {
        content: '{"findings":[{"ruleName":"Planted","severity":"high","message":"m","path":"src/a.ts","startLine":1}],"overview":"o"}',
        model: "recorded",
      };
    };
    const artifacts = await review({
      root: plantedRoot,
      outDir,
      probes: [metricsProbe],
      complete: stub,
      passes: ["bug"],
      now: fixedNow,
    });
    assert.equal(calls.length, 1);
    const probes = artifacts.report.probes ?? [];
    assert.ok(probes.some((run) => run.probe === "llm/bug" && run.status === "ok"));
    assert.ok(artifacts.report.findings.some((finding) => finding.ruleId.startsWith("llm/bug.")));
  });
});

test("CLI arguments parse into a review, and mistakes name themselves", () => {
  const parsed = parseReviewArgs([
    "review",
    "/repo",
    "--out",
    "/tmp/report",
    "--categories",
    "security,bug",
    "--severity",
    "high",
    "--no-llm",
  ]);
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.command, "review");
  assert.equal(parsed.root, "/repo");
  assert.equal(parsed.out, "/tmp/report");
  assert.deepEqual(parsed.categories, ["security", "bug"]);
  assert.equal(parsed.minSeverity, "high");
  assert.equal(parsed.useLlm, false);

  assert.match(parseReviewArgs(["review", "/repo", "--severity", "urgent"]).error ?? "", /unknown severity/);
  assert.match(parseReviewArgs(["audit", "/repo"]).error ?? '', /expected "review"/);
  assert.match(parseReviewArgs(["review"]).error ?? "", /needs a path/);
});

test("findings in tooling artifacts are dropped as out of scope, and the drop is recorded", async () => {
  await withTempDir(async (outDir) => {
    const artifacts = await review({
      root: plantedRoot,
      outDir,
      probes: [metricsProbe],
      complete: async () => ({
        content:
          '{"findings":[{"ruleName":"credential","severity":"critical","message":"leaked","path":".claude/worktrees/old/src/a.ts","startLine":1}],"overview":"o"}',
        model: "recorded",
      }),
      passes: ["bug"],
      now: fixedNow,
    });
    assert.ok(!artifacts.report.findings.some((f) => f.locations[0]?.path.includes("worktrees")));
    const scope = (artifacts.report.probes ?? []).find((run) => run.probe === "scope");
    assert.ok(scope, "the drop must be recorded in probes[]");
    assert.match(scope.detail ?? "", /1 finding\(s\)/);
  });
});
