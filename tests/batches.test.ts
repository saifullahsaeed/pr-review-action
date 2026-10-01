import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { planBatches, validateBatchBudget } from "../src/llm/batches.ts";
import { review } from "../src/pipeline.ts";
import { runJudgement } from "../src/llm/judgement.ts";

function repo() {
  const root = mkdtempSync(join(tmpdir(), "harrier-batches-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.invalid");
  writeFileSync(join(root, "seed.ts"), "export const seed = 1;\n"); git("add", "."); git("commit", "-m", "base");
  return { root, git };
}
test("400 changed files are all supplied in bounded batches and JSON/Markdown coverage", async () => {
  const { root, git } = repo();
  try {
    for (let i = 0; i < 400; i++) writeFileSync(join(root, `file-${i}.ts`), `export const value${i} = ${i};\n`);
    git("add", "."); git("commit", "-m", "400 changes");
    const budget = validateBatchBudget({ maxFiles: 20, maxChars: 4096 });
    const plan = planBatches(root, budget, "HEAD~1");
    assert.equal(plan.coverage.plannedFiles, 400);
    assert.equal(new Set(plan.batches.flatMap(b => b.ranges.map(r => r.path))).size, 400);
    assert.equal(plan.coverage.skipped.length, 0);
    for (const b of plan.batches) { assert.ok(b.context.body.length <= 4096); assert.ok(b.context.included.length <= 20); }
    let calls = 0;
    const result = await review({ root, outDir: join(root, "report"), probes: [], diffRef: "HEAD~1", budget, passes: ["bug"], complete: async () => { calls++; return { content: '{"findings":[]}', model: "test" }; } });
    assert.equal(calls, plan.batches.length);
    assert.equal(result.report.aiCoverage?.status, "complete");
    const json = JSON.parse(readFileSync(result.paths.json, "utf8"));
    assert.equal(json.aiCoverage.plannedFiles, 400);
    assert.match(readFileSync(result.paths.markdown, "utf8"), /400 planned files/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("deep changes retain real line numbers; chunk large hunks and retrieve caller excerpts", () => {
  const { root, git } = repo();
  try {
    writeFileSync(join(root, "large.ts"), Array.from({ length: 1000 }, (_, i) => `export const x${i} = ${i};`).join("\n"));
    writeFileSync(join(root, "caller.ts"), 'import { x900 } from "./large";\nexport const y = x900;\n');
    git("add", "."); git("commit", "-m", "large base");
    const lines = readFileSync(join(root, "large.ts"), "utf8").split("\n"); lines[900] = 'export const x900 = eval("unsafe");';
    writeFileSync(join(root, "large.ts"), lines.join("\n"));
    const plan = planBatches(root, validateBatchBudget({ maxLinesPerFile: 3 }), "HEAD");
    assert.ok(plan.batches.some(b => b.context.body.includes('901| export const x900 = eval')));
    assert.ok(plan.batches.some(b => b.supportRanges.some(r => r.path === "caller.ts")));
    assert.ok(plan.batches.every(b => b.ranges.every(r => r.endLine - r.startLine + 1 <= 3)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("caps, oversized lines, unsupported files and invalid diff references are explicit", async () => {
  const { root, git } = repo();
  try {
    writeFileSync(join(root, "big.ts"), "x".repeat(10000));
    writeFileSync(join(root, "note.txt"), "unsupported");
    for (let i = 0; i < 4; i++) writeFileSync(join(root, `part${i}.ts`), "const x = 1;\n");
    git("add", "."); git("commit", "-m", "changes");
    const plan = planBatches(root, validateBatchBudget({ maxFiles: 1, maxChars: 512, maxBatches: 1 }), "HEAD~1");
    assert.equal(plan.batches.length, 1);
    assert.ok(plan.coverage.skipped.some(s => s.reason.includes("Line exceeds")));
    assert.ok(plan.coverage.skipped.some(s => s.reason.includes("Maximum batch")));
    assert.ok(plan.coverage.skipped.some(s => s.path === "note.txt"));
    const result = await review({ root, outDir: join(root, "report"), probes: [], diffRef: "not-a-ref", complete: async () => { throw new Error("must not fall back"); } });
    assert.equal(result.report.aiCoverage?.status, "failed");
    assert.equal(result.report.aiCoverage?.batches.length, 0);
    assert.throws(() => validateBatchBudget({ maxFiles: 0 }));
    assert.throws(() => validateBatchBudget({ maxChars: null }));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("partial pass failures preserve successful batches and coverage", async () => {
  const { root } = repo();
  try {
    writeFileSync(join(root, "other.ts"), "export const other = 1;\n");
    let calls = 0;
    const result = await review({ root, outDir: join(root, "report"), probes: [], budget: { maxFiles: 1 }, passes: ["bug"], complete: async () => { if (++calls === 1) throw new Error("timeout"); return { content: '{"findings":[]}', model: "test" }; } });
    assert.equal(result.report.aiCoverage?.status, "partial");
    assert.equal(result.report.aiCoverage?.batches.length, 2);
    assert.equal(result.report.aiCoverage?.batches[1]?.passes[0]?.status, "ok");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("findings outside supplied line ranges are rejected before verification", async () => {
  const context = { root: "/unused", tree: "large.ts", body: "900| dangerous();", included: ["large.ts"], truncated: [], ranges: [{ path: "large.ts", startLine: 900, endLine: 900 }] };
  const candidate = (line: number) => ({ ruleName: "Bug", severity: "high", path: "large.ts", startLine: line, message: "unsafe", confidence: "high" });
  const result = await runJudgement(async () => ({ content: JSON.stringify({ findings: [candidate(1), candidate(900)] }), model: "test" }), context, ["bug"]);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0]?.locations[0]?.startLine, 900);
  assert.equal(result.dropped.length, 1);
});
