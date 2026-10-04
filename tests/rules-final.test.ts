import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateEnforcementPolicy } from "../src/rules/policy.ts";
import { checkProjectRules } from "../src/rules/check.ts";

test("inline config rules need no AGENTS or separate citation; nested receiver calls match", () => {
  const root = mkdtempSync(join(tmpdir(), "harrier-inline-"));
  try {
    const raw = { version: 1, rules: [{ id: "no-legacy", description: "No legacy auth", status: "approved", required: true, severity: "high", scope: ["*.py"], checker: { kind: "python-call", forbidden: ["*.has_perm"] } }] };
    writeFileSync(join(root, "harrier.config.json"), JSON.stringify({ enforcement: raw }));
    writeFileSync(join(root, "view.py"), "request.user.has_perm('x')\n");
    const policy = validateEnforcementPolicy(raw)!;
    assert.deepEqual(policy.rules[0]?.source, { path: "harrier.config.json", startLine: 1 });
    const result = checkProjectRules({ root, trustedRoot: root, policy, changedFiles: ["view.py"] });
    assert.equal(result[0]?.status, "fail");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Action runner exposes missing required document review before final enforcement", () => {
  const dir = mkdtempSync(join(tmpdir(), "harrier-doc-action-"));
  const root = join(dir, "repo"); mkdirSync(root);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();
  try {
    git("init", "-b", "main"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
    writeFileSync(join(root, "RULES.md"), "Views must call services\n");
    writeFileSync(join(root, "view.py"), "service()\n");
    writeFileSync(join(root, "harrier.config.json"), JSON.stringify({ gate: { requiredProbes: [], failOn: "never" }, enforcement: { version: 1, documents: [{ id: "rules", paths: ["RULES.md"], scope: ["*.py"], required: true, role: "standards" }] } }));
    git("add", "."); git("commit", "-m", "trusted rules");
    const base = git("rev-parse", "HEAD");
    writeFileSync(join(root, "view.py"), "updated_service()\n");
    writeFileSync(join(root, "harrier.config.json"), "{}");
    const output = join(dir, "outputs");
    const runner = new URL("../scripts/action-run.ts", import.meta.url).pathname;
    const result = spawnSync(process.execPath, [runner], { encoding: "utf8", env: { ...process.env, GITHUB_WORKSPACE: root, RUNNER_TEMP: dir, GITHUB_OUTPUT: output, HARRIER_BASE_SHA: base, HARRIER_ENABLE_LLM: "false", HARRIER_FAIL_ON: "" } });
    assert.equal(result.status, 0, result.stderr);
    const data = readFileSync(output, "utf8"); assert.match(data, /exit-code=2/);
    const out = /report-dir=(.+)/.exec(data)![1]!;
    const report = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
    assert.equal(report.enforcement.documents[0].status, "incomplete");
    assert.match(readFileSync(join(out, "report.md"), "utf8"), /No model configured/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
