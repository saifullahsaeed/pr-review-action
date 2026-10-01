import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { buildReport } from "../src/report.ts";
import { runProbes } from "../src/probes/run.ts";
import { evaluateGate, validateGatePolicy, relativeFinding } from "../src/gate.ts";
import type { GatePolicy } from "../src/gate.ts";
import type { FindingInput } from "../src/findings.ts";

const policy: GatePolicy = { failOn: "medium", scope: "new", requiredProbes: ["metrics"] };
const input = (overrides: Partial<FindingInput> = {}): FindingInput => ({ ruleId: "metrics/example", ruleName: "Example", severity: "high", category: "quality", message: "Same problem", source: "probe", probe: "metrics", locations: [{ path: "src/a.ts", startLine: 1 }], ...overrides });
function report(findings: FindingInput[], status: "ok" | "failed" = "ok") {
  return buildReport({ tool: { name: "harrier", version: "test" }, target: { root: "/repo" }, startedAt: "x", finishedAt: "x", findings, probes: [{ probe: "metrics", status, categories: ["quality"] }] }).report;
}
test("gate policy rejects unknown fields, levels and probes", () => {
  assert.throws(() => validateGatePolicy({ failOn: "urgent" }));
  assert.throws(() => validateGatePolicy({ requiredProbes: ["metrcs"] }));
  assert.throws(() => validateGatePolicy({ typo: true }));
  assert.throws(() => validateGatePolicy(null));
  assert.throws(() => validateGatePolicy({ failOn: null }));
  assert.throws(() => validateGatePolicy({ requiredProbes: null }));
});
test("clean pass, new violation fail, required failure incomplete, AI advisory", () => {
  assert.equal(evaluateGate(report([]), policy).status, "pass");
  assert.equal(evaluateGate(report([input()]), policy).exitCode, 1);
  assert.equal(evaluateGate(report([], "failed"), policy).exitCode, 2);
  const ai = evaluateGate(report([input({ source: "llm", confidence: "high" })]), policy);
  assert.equal(ai.status, "pass");
  assert.equal(ai.advisory.length, 1);
});
test("baseline matches line drift, counts extra occurrences and detects worsening", () => {
  const base = report([input({ severity: "medium" })]);
  const unchanged = report([input({ severity: "medium", locations: [{ path: "src/a.ts", startLine: 100 }] })]);
  assert.equal(evaluateGate(unchanged, policy, base, { status: "ok" }).status, "pass");
  assert.equal(evaluateGate(report([input()]), policy, base).changes[0]?.status, "worsened");
  const extra = report([input({ severity: "medium" }), input({ locations: [{ path: "src/a.ts", startLine: 5 }] })]);
  const result = evaluateGate(extra, policy, base);
  assert.equal(result.changes.filter(c => c.status === "new").length, 1);
  assert.equal(result.status, "fail");
  assert.equal(evaluateGate(report([]), policy, base).resolved.length, 1);
  assert.equal(evaluateGate(unchanged, { ...policy, scope: "all" }, base).status, "fail");
});
test("baseline gaps never pass or claim resolved findings; never threshold still enforces coverage", () => {
  const result = evaluateGate(report([]), policy, report([input()], "failed"), { status: "ok" });
  assert.equal(result.status, "incomplete");
  assert.deepEqual(result.resolved, []);
  assert.equal(evaluateGate(report([]), policy, undefined, { status: "failed", detail: "invalid ref" }).status, "incomplete");
  assert.equal(evaluateGate(report([], "failed"), { ...policy, failOn: "never" }).status, "incomplete");
});
test("failed optional current scan does not falsely resolve baseline issues", () => {
  const result = evaluateGate(report([], "failed"), { ...policy, requiredProbes: [] }, report([input()]), { status: "ok" });
  assert.deepEqual(result.resolved, []);
});

test("scanner exceptions become failed coverage rather than aborting reports", async () => {
  const sweep = await runProbes([{ name: "metrics", categories: ["quality"], async run() { throw new Error("malformed scanner JSON"); } }], { root: "/unused", timeoutMs: 10 });
  assert.equal(sweep.runs[0]?.status, "failed");
  assert.match(sweep.runs[0]?.detail ?? "", /malformed/);
});

test("absolute scanner paths and messages normalize across checkout roots", () => {
  const f = report([input({ message: "file /repo/src/a.ts", locations: [{ path: "/repo/src/a.ts", startLine: 1 }] })]).findings[0]!;
  assert.equal(relativeFinding(f, "/repo").locations[0]?.path, "src/a.ts");
  assert.equal(relativeFinding(f, "/repo").message, "file ./src/a.ts");
});

test("CLI integration: clean, new violation, unchanged debt, required failure and invalid baseline", () => {
  const dir = mkdtempSync(join(tmpdir(), "harrier-gate-test-"));
  const root = join(dir, "repo");
  const bin = join(dir, "bin");
  mkdirSync(root); mkdirSync(bin);
  const git = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  symlinkSync(git, join(bin, "git"));
  const gitCmd = (...args: string[]): string => execFileSync(git, args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" } });
  const config = join(dir, "policy.json");
  writeFileSync(config, JSON.stringify({ gate: policy }));
  const cli = new URL("../src/cli.ts", import.meta.url).pathname;
  let runId = 0;
  const run = (extra: string[] = []) => {
    const out = join(dir, `out-${runId++}`);
    const result = spawnSync(process.execPath, [cli, "review", root, "--no-llm", "--gate", "--policy-file", config, "--out", out, ...extra], { encoding: "utf8", env: { ...process.env, PATH: bin } });
    assert.ok(readFileSync(join(out, "report.md"), "utf8").includes("Harrier quality gate"), result.stderr);
    return { result, gate: JSON.parse(readFileSync(join(out, "gate.json"), "utf8")) };
  };
  try {
    gitCmd("init"); gitCmd("config", "user.name", "Test"); gitCmd("config", "user.email", "test@example.com");
    writeFileSync(join(root, "a.ts"), "export const a = 1;\n");
    gitCmd("add", "."); gitCmd("commit", "-m", "clean base");
    const clean = gitCmd("rev-parse", "HEAD").trim();
    assert.equal(run(["--baseline", clean]).result.status, 0);
    writeFileSync(join(root, "a.ts"), "import { b } from './b';\nexport const a = b;\n");
    writeFileSync(join(root, "b.ts"), "import { a } from './a';\nexport const b = a;\n");
    const newIssue = run(["--baseline", clean, "--categories", "secret", "--severity", "critical"]);
    assert.equal(newIssue.result.status, 1, newIssue.result.stderr);
    assert.equal(newIssue.gate.status, "fail");
    gitCmd("add", "."); gitCmd("commit", "-m", "legacy cycle");
    const debt = gitCmd("rev-parse", "HEAD").trim();
    const same = run(["--baseline", debt]);
    assert.equal(same.result.status, 0, same.result.stderr);
    assert.ok(same.gate.changes.some((c: { status: string }) => c.status === "existing"));
    writeFileSync(config, JSON.stringify({ gate: { ...policy, requiredProbes: ["gitleaks"] } }));
    const missing = run();
    assert.equal(missing.result.status, 2);
    assert.equal(missing.gate.status, "incomplete");
    writeFileSync(join(bin, "gitleaks"), '#!/bin/sh\nprintf "{}"\nexit 2\n', { mode: 0o755 });
    const broken = run();
    assert.equal(broken.result.status, 2);
    assert.equal(broken.gate.status, "incomplete");
    writeFileSync(config, JSON.stringify({ gate: policy }));
    assert.equal(run(["--baseline", "not-a-ref"]).result.status, 2);
    assert.equal(gitCmd("worktree", "list", "--porcelain").split("worktree ").length, 2, "temporary baseline worktrees cleaned up");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
