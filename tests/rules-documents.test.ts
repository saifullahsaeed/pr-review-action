import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateEnforcementPolicy } from "../src/rules/policy.ts";
import { reviewDocuments } from "../src/rules/documents.ts";
import type { CompleteFn } from "../src/llm/judgement.ts";
function fixture(run: (root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "harrier-docs-"));
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "docs/RULES.md"), "# Architecture\nViews must call services.\n");
  writeFileSync(join(root, "view.py"), "Model.objects.create()\n");
  return run(root).finally(() => rmSync(root, { recursive: true, force: true }));
}
const policy = () => validateEnforcementPolicy({ version: 1, documents: [{ id: "architecture", paths: ["docs"], scope: ["*.py"], role: "standards", required: true }] })!;
const violation = () => ({ requirement: { path: "docs/RULES.md", line: 2, quote: "Views must call services." }, code: { path: "view.py", line: 1, quote: "Model.objects.create()" }, message: "Direct model write violates service boundary" });
const mock = (response: unknown): CompleteFn => async () => ({ content: JSON.stringify(response), model: "fixture" });

test("configuration-only documents load folders and supply numbered source without AGENTS", () => fixture(async root => {
  let called = false;
  const complete: CompleteFn = async messages => {
    called = true;
    assert.match(messages[1]!.content, /2\| Views must call services/);
    assert.match(messages[1]!.content, /1\| Model.objects.create/);
    return { content: JSON.stringify({ status: "pass", detail: "All applicable requirements reviewed", violations: [] }), model: "fixture" };
  };
  const results = await reviewDocuments({ root, trustedRoot: root, policy: policy(), changedFiles: ["view.py"], complete });
  assert.equal(called, true);
  assert.equal(results[0]?.status, "pass");
  assert.deepEqual(results[0]?.documents, ["docs/RULES.md"]);
}));

test("exact document and code citations plus verifier confirmation are required for fail", () => fixture(async root => {
  let requests = 0;
  const complete: CompleteFn = async () => ({ content: JSON.stringify(++requests === 1 ? { status: "fail", detail: "Service boundary violation", violations: [violation()] } : { confirmed: [true], detail: "Confirmed against mandatory section" }), model: "fixture" });
  const results = await reviewDocuments({ root, trustedRoot: root, policy: policy(), changedFiles: ["view.py"], complete });
  assert.equal(requests, 2);
  assert.equal(results[0]?.status, "fail");
  assert.equal(results[0]?.violations[0]?.verified, true);
}));

test("invented citations, inconsistent verdicts and disputed findings are incomplete", () => fixture(async root => {
  for (const response of [
    { status: "fail", detail: "x", violations: [] },
    { status: "pass", detail: "x", violations: [violation()] },
    { status: "fail", detail: "x", violations: [{ ...violation(), code: { path: "view.py", line: 10, quote: "invented" } }] },
    { status: "fail", detail: "x", violations: [{ ...violation(), requirement: { path: "docs/RULES.md", line: 2, quote: "invented" } }] },
  ]) {
    const results = await reviewDocuments({ root, trustedRoot: root, policy: policy(), changedFiles: ["view.py"], complete: mock(response) });
    assert.equal(results[0]?.status, "incomplete");
  }
  let requests = 0;
  const results = await reviewDocuments({ root, trustedRoot: root, policy: policy(), changedFiles: ["view.py"], complete: async () => ({ content: JSON.stringify(++requests === 1 ? { status: "fail", detail: "x", violations: [violation()] } : { confirmed: [false] }), model: "fixture" }) });
  assert.equal(results[0]?.status, "incomplete");
}));

test("missing model/docs, oversized context and unsupported folder material expose gaps", () => fixture(async root => {
  const opts = { root, trustedRoot: root, policy: policy(), changedFiles: ["view.py"] };
  assert.equal((await reviewDocuments(opts))[0]?.status, "incomplete");
  opts.policy.documents[0]!.paths = ["missing.md"];
  assert.match((await reviewDocuments(opts))[0]!.detail, /ENOENT/);
  opts.policy.documents[0]!.paths = ["docs"];
  writeFileSync(join(root, "docs/RULES.md"), "X".repeat(2000));
  opts.policy.maxContextChars = 1000;
  assert.match((await reviewDocuments(opts))[0]!.detail, /maxContextChars/);
  writeFileSync(join(root, "docs/binary.pdf"), "binary");
  assert.match((await reviewDocuments(opts))[0]!.detail, /Unsupported document/);
}));

test("AGENTS chain is an optional source and reference docs cannot become mandatory requirements", () => fixture(async root => {
  writeFileSync(join(root, "AGENTS.md"), "# Root\n[PROPOSED] Change layout\n");
  const p = validateEnforcementPolicy({ version: 1, agents: { enabled: true, required: true } })!;
  assert.equal((await reviewDocuments({ root, trustedRoot: root, policy: p, changedFiles: ["view.py"] }))[0]?.sourceId, "agents-chain");
  const reference = policy(); reference.documents[0]!.role = "reference";
  const response = { status: "fail", detail: "x", violations: [violation()] };
  const results = await reviewDocuments({ root, trustedRoot: root, policy: reference, changedFiles: ["view.py"], complete: mock(response) });
  assert.equal(results[0]?.status, "incomplete");
}));

test("document symlinks are not followed outside trusted tree", () => fixture(async root => {
  symlinkSync("/etc/hosts", join(root, "docs/escape.md"));
  const results = await reviewDocuments({ root, trustedRoot: root, policy: policy(), changedFiles: ["view.py"] });
  assert.equal(results[0]?.status, "incomplete");
}));

test("document configuration validates scopes, roles, IDs and paths", () => {
  for (const document of [
    { id: "x", paths: ["../doc.md"], scope: ["**"], role: "standards", required: true },
    { id: "x", paths: ["docs"], scope: [], role: "standards", required: true },
    { id: "x", paths: ["docs"], scope: ["**"], role: "unknown", required: true },
  ]) assert.throws(() => validateEnforcementPolicy({ version: 1, documents: [document] }));
  assert.throws(() => validateEnforcementPolicy({ version: 1, agents: { enabled: false, required: true } }));
});
