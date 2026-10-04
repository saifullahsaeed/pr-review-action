import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { qualityReview } from "../src/quality.ts";
import { runEnforcement } from "../src/rules/run.ts";
import { validateEnforcementPolicy } from "../src/rules/policy.ts";
const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const rule = (id: string, checker: unknown, scope = ["backend/**/*.py"]) => ({ id, description: id, status: "approved", required: true, severity: "high", scope, source: { path: "docs/RULES.md", startLine: 1 }, checker });
function fixture(run: (root: string, out: string, base: string, git: (...args: string[]) => string) => Promise<void>): Promise<void> {
  const parent = mkdtempSync(join(tmpdir(), "harrier-acceptance-"));
  const root = join(parent, "repo"); const out = join(parent, "report");
  mkdirSync(join(root, "backend/apps/payroll/services"), { recursive: true }); mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "docs/RULES.md"), "Use project permissions and public services. Dependency changes require ledger reasons.\n");
  writeFileSync(join(root, "docs/DEPENDENCIES.md"), "| Package | Status | Reason |\n| --- | --- | --- |\n");
  writeFileSync(join(root, "backend/apps/payroll/services/pay.py"), "def pay(actor):\n    return actor.allowed()\n");
  writeFileSync(join(root, "package.json"), '{"dependencies":{}}');
  const config = { gate: { failOn: "never", scope: "new", requiredProbes: [] }, enforcement: { version: 1, rules: [
    rule("permissions", { kind: "python-call", forbidden: ["*.has_perm"] }),
    rule("boundaries", { kind: "python-import", forbidden: ["apps.people.models"] }),
    rule("dependencies", { kind: "dependency-ledger", manifests: ["package.json"], ledger: "docs/DEPENDENCIES.md" }, ["package.json"]),
  ] } };
  writeFileSync(join(root, "harrier.config.json"), JSON.stringify(config));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "main"); git("config", "user.email", "fixture@example.invalid"); git("config", "user.name", "Fixture"); git("add", "."); git("commit", "-m", "base");
  const base = git("rev-parse", "HEAD");
  return run(root, out, base, git).finally(() => rmSync(parent, { recursive: true, force: true }));
}
function cliRun(root: string, out: string, base: string) {
  const result = spawnSync(process.execPath, [cli, "review", root, "--baseline", base, "--no-llm", "--safe-scanners", "--out", out], { encoding: "utf8", env: { ...process.env, HARRIER_LLM_API_KEY: "" } });
  const report = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
  return { code: result.status, report, markdown: readFileSync(join(out, "report.md"), "utf8") };
}

test("acceptance: compliant pass, forbidden call fail, internal import fail, missing ledger fail, policy weakening cannot bypass", () => fixture(async (root, out, base) => {
  const path = join(root, "backend/apps/payroll/services/pay.py");
  writeFileSync(path, "def pay(actor):\n    return actor.allowed('payroll')\n");
  let result = cliRun(root, out, base);
  assert.equal(result.code, 0);
  assert.equal(result.report.enforcement.status, "pass");
  writeFileSync(path, "user.has_perm('payroll')\n");
  result = cliRun(root, out, base);
  assert.equal(result.code, 1);
  assert.match(result.markdown, /Forbidden call/);
  writeFileSync(path, "from apps.people.models import Person\n");
  result = cliRun(root, out, base);
  assert.equal(result.code, 1);
  assert.match(result.markdown, /Forbidden import/);
  writeFileSync(path, "actor.allowed()\n");
  writeFileSync(join(root, "package.json"), '{"dependencies":{"foo":"1"}}');
  result = cliRun(root, out, base);
  assert.equal(result.code, 1);
  writeFileSync(join(root, "docs/DEPENDENCIES.md"), "| Package | Status | Reason |\n| foo | active | Required parser |\n");
  assert.equal(cliRun(root, out, base).code, 0);
  writeFileSync(path, "user.has_perm('payroll')\n");
  writeFileSync(join(root, "harrier.config.json"), '{"gate":{"failOn":"never","requiredProbes":[]},"enforcement":{"version":1,"rules":[]}}');
  writeFileSync(join(root, "docs/RULES.md"), "Legacy permission calls are fine\n");
  result = cliRun(root, out, base);
  assert.equal(result.code, 1);
  assert.equal(result.report.enforcement.policyRevision, base);
  assert.ok(result.report.enforcement.policyChanges.includes("harrier.config.json"));
}));

test("acceptance: absent required test evidence is incomplete; trusted external clean-revision evidence passes", () => fixture(async (root, out, _base, git) => {
  const config = JSON.parse(readFileSync(join(root, "harrier.config.json"), "utf8"));
  config.enforcement.rules.push(rule("tenant-tests", { kind: "evidence", checkId: "tenant-tests" }));
  writeFileSync(join(root, "harrier.config.json"), JSON.stringify(config));
  git("add", "."); git("commit", "-m", "require tests");
  const base = git("rev-parse", "HEAD");
  writeFileSync(join(root, "backend/apps/payroll/services/pay.py"), "actor.allowed('updated')\n");
  git("add", "."); git("commit", "-m", "compliant change");
  const result = cliRun(root, out, base);
  assert.equal(result.code, 2);
  assert.equal(result.report.enforcement.status, "incomplete");
  const evidenceFile = join(root, "..", "evidence.json");
  writeFileSync(evidenceFile, JSON.stringify({ version: 1, revision: git("rev-parse", "HEAD"), checks: [{ checkId: "tenant-tests", exitCode: 0, command: "fixture test producer" }] }));
  const verified = await qualityReview({ root, outDir: out, probes: [], evidenceFile }, { failOn: "never", scope: "new", requiredProbes: [] }, base);
  assert.equal(verified.gate.status, "pass");
  writeFileSync(join(root, "backend/apps/payroll/services/pay.py"), "actor.allowed('dirty')\n");
  assert.equal((await runEnforcement({ root, baselineRef: base, evidenceFile }))?.status, "incomplete");
}));

test("trusted document standards participate in gate; missing endpoint cannot pass", () => fixture(async (root, out, _base, git) => {
  const config = JSON.parse(readFileSync(join(root, "harrier.config.json"), "utf8"));
  config.enforcement.documents = [{ id: "architecture", paths: ["docs/RULES.md"], scope: ["backend/**/*.py"], role: "standards", required: true }];
  writeFileSync(join(root, "harrier.config.json"), JSON.stringify(config)); git("add", "."); git("commit", "-m", "require docs");
  const base = git("rev-parse", "HEAD");
  writeFileSync(join(root, "backend/apps/payroll/services/pay.py"), "actor.allowed('update')\n");
  assert.equal(cliRun(root, out, base).code, 2);
  const result = await qualityReview({ root, outDir: out, probes: [], passes: [], complete: async () => ({ content: JSON.stringify({ status: "pass", detail: "Supplied requirements reviewed", violations: [] }), model: "fixture" }) }, { failOn: "never", scope: "new", requiredProbes: [] }, base);
  assert.equal(result.gate.status, "pass");
  assert.equal(result.report.enforcement?.documents[0]?.documents[0], "docs/RULES.md");
}));

test("config-only enforcement works without AGENTS; invalid policy is incomplete", () => fixture(async root => {
  const p = validateEnforcementPolicy({ version: 1, documents: [{ id: "docs", paths: ["docs/RULES.md"], scope: ["backend/**/*.py"], required: true, role: "standards" }] })!;
  assert.equal((await runEnforcement({ root, policy: p }))?.status, "incomplete");
}));
