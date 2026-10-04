import assert from "node:assert/strict";
import { test } from "node:test";
import { tokenBoundedComplete, validateTokenBudget, countTextTokens } from "../src/llm/tokens.ts";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("token limits count complete message content and reject before endpoint call", async () => {
  let calls = 0;
  const messages = [{ role: "system" as const, content: "Instructions" }, { role: "user" as const, content: "Code and document context" }];
  const wrapped = tokenBoundedComplete("gpt-4o-mini", { maxInputTokens: 20, reservedTokens: 5 }, async () => { calls++; return { content: "ok", model: "fixture" }; }, (_model, supplied) => {
    assert.deepEqual(supplied, messages); return 16;
  });
  await assert.rejects(() => wrapped(messages), /exceeds/);
  assert.equal(calls, 0);
  const allowed = tokenBoundedComplete("gpt-4o-mini", { maxInputTokens: 21, reservedTokens: 5 }, async () => { calls++; return { content: "ok", model: "fixture" }; }, () => 16);
  await allowed(messages); assert.equal(calls, 1);
});

test("unsupported models and missing tokenizer data never fall back to estimates", () => {
  assert.throws(() => countTextTokens("unsupported-local-model", [{ role: "user", content: "hello" }]), /incomplete/);
  const cache = mkdtempSync(join(tmpdir(), "harrier-empty-token-cache-"));
  try {
    const result = spawnSync("python3", ["-I", fileURLToPath(new URL("../src/llm/count_tokens.py", import.meta.url))], {
      input: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hello" }] }), encoding: "utf8", env: { ...process.env, TIKTOKEN_CACHE_DIR: cache },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /cached|No module named/);
  } finally { rmSync(cache, { recursive: true, force: true }); }
});

test("token budget rejects invalid values and reserves template overhead separately", () => {
  assert.deepEqual(validateTokenBudget({ maxInputTokens: 1000 }), { maxInputTokens: 1000, reservedTokens: 256 });
  for (const b of [null, { maxInputTokens: 0 }, { maxInputTokens: 100, reservedTokens: 100 }, { maxInputTokens: 1000, typo: 1 }]) assert.throws(() => validateTokenBudget(b));
});
