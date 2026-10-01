import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
const { publish } = createRequire(import.meta.url)("../scripts/github-publish.cjs");

test("Action publishes evidence before final enforcement, with environment-bound inputs", () => {
  const yaml = readFileSync(new URL("../action.yml", import.meta.url), "utf8");
  assert.ok(yaml.indexOf("Publish Quality Evidence") < yaml.indexOf("Enforce Quality Gate"));
  assert.ok(yaml.indexOf("Upload Quality Reports") < yaml.indexOf("Enforce Quality Gate"));
  assert.match(yaml, /HARRIER_FAIL_ON: \$\{\{ inputs.fail-on \}\}/);
  assert.match(yaml, /HARRIER_BASE_SHA: \$\{\{ github.event.pull_request.base.sha \}\}/);
  assert.match(yaml, /if: always\(\)/);
  assert.doesNotMatch(yaml, /node \$\{\{ github.action_path/);
});

test("publisher updates bot summary, deduplicates inline feedback and respects changed lines/forks", async () => {
  const dir = mkdtempSync(join(tmpdir(), "harrier-publish-"));
  const previousSummary = process.env.GITHUB_STEP_SUMMARY;
  process.env.GITHUB_STEP_SUMMARY = join(dir, "summary.md");
  const calls: string[] = [];
  const comments: Array<Record<string, any>> = [{ id: 1, body: '<!-- harrier-quality-gate -->', user: { type: 'Bot' } }];
  const inline: Array<Record<string, any>> = [];
  const github = {
    paginate: async (method: () => unknown) => method(),
    rest: {
      issues: {
        listComments: () => comments,
        updateComment: async () => calls.push("update"),
        createComment: async () => calls.push("create"),
      },
      pulls: {
        listFiles: () => [{ filename: 'a.ts', patch: '@@ -1 +1,2 @@\n old\n+new' }],
        listReviewComments: () => inline,
        createReviewComment: async (c: Record<string, any>) => { calls.push("inline"); inline.push({ ...c, user: { type: 'Bot' } }); },
      },
    },
  };
  const context = { repo: { owner: 'team', repo: 'app' }, payload: { pull_request: { number: 1, head: { sha: 'abc', repo: { full_name: 'team/app' } } } } };
  const warnings: string[] = [];
  const core = { warning: (m: string) => warnings.push(m) };
  writeFileSync(join(dir, "report.md"), '<!-- harrier-quality-gate -->\nGate failed\n');
  writeFileSync(join(dir, "report.json"), JSON.stringify({ gate: { blockers: ['a', 'b'], changes: [{ findingId: 'a', identity: 'stable' }] }, findings: [{ id: 'a', severity: 'high', ruleId: 'test', message: 'm', locations: [{ path: 'a.ts', startLine: 2 }] }, { id: 'b', locations: [{ path: 'a.ts', startLine: 99 }] }] }));
  try {
    await publish({ github, context, core, outDir: dir });
    await publish({ github, context, core, outDir: dir });
    assert.equal(calls.filter(c => c === 'inline').length, 1);
    assert.equal(calls.filter(c => c === 'update').length, 2);
    assert.equal(calls.filter(c => c === 'create').length, 0);
    assert.ok(readFileSync(process.env.GITHUB_STEP_SUMMARY!, 'utf8').includes('Gate failed'));
    context.payload.pull_request.head.repo.full_name = 'fork/app';
    const before = calls.length;
    await publish({ github, context, core, outDir: dir });
    assert.equal(calls.length, before);
    context.payload.pull_request.head.repo.full_name = 'team/app';
    github.rest.issues.listComments = () => { throw new Error('403'); };
    await publish({ github, context, core, outDir: dir });
    assert.equal(warnings.length, 1);
  } finally {
    if (previousSummary === undefined) delete process.env.GITHUB_STEP_SUMMARY;
    else process.env.GITHUB_STEP_SUMMARY = previousSummary;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Action runner uses base policy, preserves violation exit for publishing, and rejects unavailable base", () => {
  const dir = mkdtempSync(join(tmpdir(), "harrier-action-test-"));
  const root = join(dir, 'repo'); const bin = join(dir, 'bin');
  mkdirSync(root); mkdirSync(bin);
  const git = execFileSync('which', ['git'], { encoding: 'utf8' }).trim(); symlinkSync(git, join(bin, 'git'));
  const g = (...args: string[]) => execFileSync(git, args, { cwd: root, encoding: 'utf8' });
  try {
    g('init'); g('config', 'user.name', 'Test'); g('config', 'user.email', 'test@example.com');
    writeFileSync(join(root, 'harrier.config.json'), JSON.stringify({ gate: { failOn: 'medium', requiredProbes: ['metrics'] } }));
    writeFileSync(join(root, 'a.ts'), 'export const a=1;\n');
    g('add', '.'); g('commit', '-m', 'trusted policy');
    const base = g('rev-parse', 'HEAD').trim();
    g('remote', 'add', 'origin', root);
    writeFileSync(join(root, 'harrier.config.json'), JSON.stringify({ gate: { failOn: 'never', requiredProbes: [] } }));
    writeFileSync(join(root, 'a.ts'), "import { b } from './b';\nexport const a=b;\n");
    writeFileSync(join(root, 'b.ts'), "import { a } from './a';\nexport const b=a;\n");
    const output = join(dir, 'outputs');
    const env = { ...process.env, PATH: bin, GITHUB_WORKSPACE: root, RUNNER_TEMP: dir, GITHUB_OUTPUT: output, HARRIER_BASE_SHA: base, HARRIER_ENABLE_LLM: 'false', HARRIER_FAIL_ON: '' };
    const runner = new URL('../scripts/action-run.ts', import.meta.url).pathname;
    const result = spawnSync(process.execPath, [runner], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const data = readFileSync(output, 'utf8');
    assert.match(data, /exit-code=1/);
    const out = /report-dir=(.+)/.exec(data)![1]!;
    const gate = JSON.parse(readFileSync(join(out, 'gate.json'), 'utf8'));
    assert.equal(gate.policy.failOn, 'medium');
    assert.equal(gate.status, 'fail');
    const badOutput = join(dir, 'bad-output');
    const bad = spawnSync(process.execPath, [runner], { env: { ...env, GITHUB_OUTPUT: badOutput, HARRIER_BASE_SHA: 'bad-ref' }, encoding: 'utf8' });
    assert.equal(bad.status, 0);
    assert.match(readFileSync(badOutput, 'utf8'), /exit-code=2/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
