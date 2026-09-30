import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { validateFindingInput } from "../src/findings.ts";
import { configFromEnv, DEFAULT_BASE_URL, DEFAULT_MODEL } from "../src/llm/config.ts";
import { buildContext } from "../src/llm/context.ts";
import { extractJson, parseJudgementResponse, runJudgement } from "../src/llm/judgement.ts";
import type { ChatMessage } from "../src/llm/client.ts";

function recorded(name: string): string {
  return readFileSync(new URL(`./fixtures/outputs/${name}`, import.meta.url), "utf8");
}

const plantedRoot = new URL("./fixtures/planted/", import.meta.url).pathname;

test("extractJson takes the object out of fences and prose", () => {
  assert.deepEqual(extractJson('Sure!\n```json\n{"findings":[]}\n```\nDone.'), { findings: [] });
  assert.deepEqual(extractJson('{"overview":"clean"}'), { overview: "clean" });
  assert.throws(() => extractJson("nothing structural here"));
});

test("a recorded structure response becomes findings, and the locationless one is dropped", () => {
  const parsed = parseJudgementResponse("structure", recorded("llm-structure.txt"));
  assert.equal(parsed.findings.length, 1, "only the finding with a path and line may survive");
  assert.equal(parsed.dropped.length, 1);
  const finding = parsed.findings[0];
  assert.ok(finding);
  assert.equal(finding.ruleId, "llm/structure.layering-violation");
  assert.equal(finding.category, "structure");
  assert.equal(finding.source, "llm");
  assert.equal(finding.locations[0]?.path, "src/a.ts");
  assert.equal(finding.locations[0]?.startLine, 1);
  assert.deepEqual(validateFindingInput(finding), []);
  assert.match(parsed.overview ?? "", /cycle/);
});

test("a recorded bug response maps severity, confidence and evidence", () => {
  const parsed = parseJudgementResponse("bug", recorded("llm-bug.txt"));
  assert.equal(parsed.findings.length, 2);
  for (const finding of parsed.findings) assert.deepEqual(validateFindingInput(finding), []);
  assert.equal(parsed.findings[0]?.severity, "high");
  assert.equal(parsed.findings[0]?.category, "bug");
  assert.equal(parsed.findings[0]?.confidence, "high");
  assert.equal(parsed.findings[0]?.locations[0]?.endLine, 10);
  assert.ok(parsed.findings[0]?.evidence?.includes("sendCharge"));
});

test("runJudgement works offline through an injected endpoint and records pass status", async () => {
  const calls: ChatMessage[][] = [];
  const stub = async (messages: ChatMessage[]) => {
    calls.push(messages);
    return {
      content: calls.length === 1 ? recorded("llm-structure.txt") : '{"findings":[],"overview":"clean."}',
      model: "recorded",
    };
  };
  const result = await runJudgement(stub, buildContext(plantedRoot), ["structure", "quality"]);
  assert.equal(calls.length, 2);
  assert.equal(result.passes[0]?.status, "ok");
  assert.equal(result.passes[1]?.status, "ok");
  assert.equal(result.findings.length, 1);
  assert.equal(result.dropped.length, 1);
  assert.match(calls[0]?.[0]?.content ?? "", /You are Harrier/);
  assert.match(calls[0]?.[1]?.content ?? "", /src\/a\.ts/);
});

test("a failing pass is reported as failed with its detail, not silently dropped", async () => {
  const failing = async () => {
    throw new Error("endpoint returned 502");
  };
  const result = await runJudgement(failing, buildContext(plantedRoot), ["bug"]);
  assert.equal(result.passes[0]?.status, "failed");
  assert.match(result.passes[0]?.detail ?? "", /502/);
  assert.equal(result.findings.length, 0);
});

test("endpoint config reports what is missing instead of failing obscurely", () => {
  const empty = configFromEnv({});
  assert.equal(empty.config, undefined);
  assert.match(empty.missing.join(","), /HARRIER_LLM_API_KEY/);

  const configured = configFromEnv({ HARRIER_LLM_API_KEY: "test-key" });
  assert.equal(configured.config?.baseUrl, DEFAULT_BASE_URL);
  assert.equal(configured.config?.model, DEFAULT_MODEL);
  assert.equal(configured.missing.length, 0);

  // docker-compose hands unset vars through as empty strings; they must not become "" or 0.
  const emptyStrings = configFromEnv({
    HARRIER_LLM_API_KEY: "test-key",
    HARRIER_LLM_BASE_URL: "",
    HARRIER_LLM_MODEL: "",
    HARRIER_LLM_TIMEOUT_MS: "",
  });
  assert.equal(emptyStrings.config?.baseUrl, DEFAULT_BASE_URL);
  assert.equal(emptyStrings.config?.model, DEFAULT_MODEL);
  assert.equal(emptyStrings.config?.timeoutMs, 120000);
});

test("review context numbers its lines and records what it truncated", () => {
  const context = buildContext(plantedRoot, { maxFiles: 1, maxLinesPerFile: 2, maxTotalLines: 100 });
  assert.match(context.body, /\s+1\| /);
  assert.equal(context.included.length, 1);
  assert.ok(context.truncated.length >= 2, "files left out must be recorded as truncated");
});

test("review context prioritizes target files when supplied", () => {
  const context = buildContext(plantedRoot, {
    maxFiles: 1,
    targetFiles: ["src/dup.ts"],
  });
  assert.equal(context.included[0], "src/dup.ts");
});

test("runJudgement injects prior probe findings into the prompt", async () => {
  let userPrompt = "";
  const mockComplete = async (messages: ChatMessage[]) => {
    userPrompt = messages.find((m) => m.role === "user")?.content ?? "";
    return { content: '{"findings":[],"overview":"all good"}', model: "test-model" };
  };

  await runJudgement(
    mockComplete,
    buildContext(plantedRoot),
    ["bug"],
    [
      {
        ruleName: "SQL Injection",
        category: "security",
        severity: "high",
        message: "Unsafe string concat in query",
        path: "src/a.ts",
        line: 12,
      },
    ],
  );

  assert.match(userPrompt, /Findings from Automated Scanners & Metrics/);
  assert.match(userPrompt, /SQL Injection/);
  assert.match(userPrompt, /src\/a\.ts:12/);
});
