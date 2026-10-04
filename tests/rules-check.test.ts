import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkProjectRules, validateExecutionEvidence } from "../src/rules/check.ts";
import type { RuleCheckOptions } from "../src/rules/check.ts";
import { validateEnforcementPolicy } from "../src/rules/policy.ts";
import type { RuleChecker } from "../src/rules/policy.ts";
const sha = "a".repeat(40);
function fixture(checker: RuleChecker, run: (options: RuleCheckOptions, root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "harrier-check-"));
  mkdirSync(join(root, "backend/apps/payroll/services"), { recursive: true });
  writeFileSync(join(root, "AGENTS.md"), "# Rules\nProject requirement\n");
  const policy = validateEnforcementPolicy({ version: 1, rules: [{ id: "test.rule", description: "Fixture rule", status: "approved", required: true, severity: "high", scope: ["**"], source: { path: "AGENTS.md", startLine: 2 }, checker }] })!;
  const options: RuleCheckOptions = { root, trustedRoot: root, policy, changedFiles: ["backend/apps/payroll/services/pay.py"] };
  try { run(options, root); } finally { rmSync(root, { recursive: true, force: true }); }
}
function check(options: RuleCheckOptions) { return checkProjectRules(options)[0]!; }

test("Python AST catches calls and aliases but ignores comments and string literals", () => fixture({ kind: "python-call", forbidden: ["*.has_perm", "legacy.allowed"] }, (options, root) => {
  const path = join(root, options.changedFiles[0]!);
  writeFileSync(path, '# user.has_perm("x")\ns = "user.has_perm(x)"\nactor.allowed("x")\n');
  assert.equal(check(options).status, "pass");
  writeFileSync(path, 'from legacy import allowed as check\ncheck("x")\nuser.has_perm("x")\n');
  const result = check(options);
  assert.equal(result.status, "fail");
  assert.deepEqual(result.evidence.map(e => e.line), [2, 3]);
}));

test("Python import checker inspects absolute and relative imports", () => fixture({ kind: "python-import", forbidden: ["apps.people.models", "backend.apps.payroll.models"] }, (options, root) => {
  const path = join(root, options.changedFiles[0]!);
  writeFileSync(path, 'from apps.people.services import public_function\n');
  assert.equal(check(options).status, "pass");
  writeFileSync(path, 'from apps.people.models import Person\nfrom ..models import Pay\n');
  const result = check(options);
  assert.equal(result.status, "fail");
  assert.deepEqual(result.evidence.map(e => e.line), [1, 2]);
}));

test("parse errors, missing source and unsupported file types are incomplete", () => fixture({ kind: "python-call", forbidden: ["*.has_perm"] }, (options, root) => {
  assert.equal(check(options).status, "incomplete");
  writeFileSync(join(root, options.changedFiles[0]!), 'def broken(:\n');
  assert.equal(check(options).status, "incomplete");
  options.changedFiles = ["file.ts"];
  assert.equal(check(options).status, "incomplete");
}));

test("unsupported required semantic rule is incomplete, never AI-certified pass", () => fixture({ kind: "semantic", instructions: "Services own business logic" }, options => {
  assert.equal(check(options).status, "incomplete");
  options.changedFiles = [];
  assert.equal(check(options).status, "not-applicable");
}));

test("execution evidence requires exact revision and successful configured check", () => fixture({ kind: "evidence", checkId: "tenant-tests" }, options => {
  assert.equal(check(options).status, "incomplete");
  options.revision = sha;
  options.evidence = validateExecutionEvidence({ version: 1, revision: sha, checks: [{ checkId: "tenant-tests", exitCode: 0, command: "pytest tenant_tests" }] });
  assert.equal(check(options).status, "pass");
  options.revision = "b".repeat(40);
  assert.equal(check(options).status, "incomplete");
  options.revision = sha;
  options.evidence.checks[0]!.exitCode = 1;
  assert.equal(check(options).status, "fail");
  options.evidence.checks = [];
  assert.equal(check(options).status, "incomplete");
}));

test("invalid and duplicate evidence envelopes are rejected", () => {
  const c = { checkId: "test", exitCode: 0, command: "pytest" };
  for (const value of [null, { version: 1, revision: "main", checks: [] }, { version: 1, revision: sha, checks: [c, c] }, { version: 1, revision: sha, checks: [{ ...c, exitCode: "0" }] }, { version: 1, revision: sha, checks: [], unexpected: true }]) assert.throws(() => validateExecutionEvidence(value));
});

test("dependency deltas need changed reason rows, including removals and section moves", () => fixture({ kind: "dependency-ledger", manifests: ["package.json"], ledger: "docs/DEPENDENCIES.md" }, options => {
  options.changedFiles = ["package.json"];
  options.before = { "package.json": '{"dependencies":{"old":"1"}}', "docs/DEPENDENCIES.md": "| old | active | Needed for parsing |\n" };
  options.after = { "package.json": '{"dependencies":{"new":"1"}}', "docs/DEPENDENCIES.md": options.before["docs/DEPENDENCIES.md"]! };
  assert.equal(check(options).status, "fail");
  options.after["docs/DEPENDENCIES.md"] = "| old | removed | Replaced by new parser |\n| new | active | New parsing requirement |\n";
  assert.equal(check(options).status, "pass");
  options.after["package.json"] = '{"devDependencies":{"old":"1"}}';
  options.after["docs/DEPENDENCIES.md"] = options.before["docs/DEPENDENCIES.md"]!;
  assert.equal(check(options).status, "fail");
}));

test("ledger cannot satisfy a package by substring or header alone", () => fixture({ kind: "dependency-ledger", manifests: ["package.json"], ledger: "docs/DEPENDENCIES.md" }, options => {
  options.changedFiles = ["package.json"];
  options.before = { "package.json": '{}', "docs/DEPENDENCIES.md": "" };
  options.after = { "package.json": '{"dependencies":{"foo":"1"}}', "docs/DEPENDENCIES.md": "| foobar | active | Needed for tests |\n| foo | active | |\n" };
  assert.equal(check(options).status, "fail");
}));

test("unsupported dependency syntax and absent ledger comparisons are incomplete", () => fixture({ kind: "dependency-ledger", manifests: ["requirements.txt"], ledger: "docs/DEPENDENCIES.md" }, options => {
  options.changedFiles = ["requirements.txt"];
  assert.equal(check(options).status, "incomplete");
  options.before = { "requirements.txt": "django==5.0\n", "docs/DEPENDENCIES.md": "" };
  options.after = { "requirements.txt": "-r other.txt\n", "docs/DEPENDENCIES.md": "" };
  assert.equal(check(options).status, "incomplete");
  options.after["requirements.txt"] = "django==5.1\n";
  assert.equal(check(options).status, "fail");
  options.after["docs/DEPENDENCIES.md"] = "| django | active | Security upgrade |\n";
  assert.equal(check(options).status, "pass");
}));
