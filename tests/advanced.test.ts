import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyCandidateFindings } from "../src/llm/verifier.ts";
import { buildContext } from "../src/llm/context.ts";
import { buildCodebaseAstGraph, parseJsTsSymbols, parsePythonSymbols } from "../src/probes/astGraph.ts";
import type { FindingInput } from "../src/findings.ts";
import type { ChatMessage } from "../src/llm/client.ts";

const plantedRoot = new URL("./fixtures/planted/", import.meta.url).pathname;

test("AST graph parses JS/TS symbols, imports, and definitions", () => {
  const code = `
    import { foo } from "./foo.ts";
    export function bar() { return foo(); }
    export class Service {}
  `;
  const summary = parseJsTsSymbols("src/app.ts", code);
  assert.equal(summary.imports.length, 1);
  assert.equal(summary.imports[0]?.symbol, "foo");
  assert.ok(summary.definitions.some((d) => d.name === "bar" && d.kind === "function"));
  assert.ok(summary.definitions.some((d) => d.name === "Service" && d.kind === "class"));
});

test("AST graph parses Python functions and imports", () => {
  const pyCode = `
from app.auth import verify_token
class AuthHandler:
    def handle_request(self):
        pass
  `;
  const summary = parsePythonSymbols("app/views.py", pyCode);
  assert.ok(summary.imports.some((i) => i.symbol === "verify_token"));
  assert.ok(summary.definitions.some((d) => d.name === "AuthHandler" && d.kind === "class"));
  assert.ok(summary.definitions.some((d) => d.name === "handle_request" && d.kind === "function"));
});

test("buildCodebaseAstGraph maps files and reverse dependencies", () => {
  const graph = buildCodebaseAstGraph(plantedRoot);
  assert.ok(graph.files.size > 0);
  assert.ok(graph.symbolIndex.size > 0);
});

test("verifyCandidateFindings drops hallucinated findings based on verifier feedback", async () => {
  const mockComplete = async (messages: ChatMessage[]) => {
    return {
      content: JSON.stringify({
        verdicts: [
          { findingIndex: 0, status: "keep", reason: "real bug" },
          { findingIndex: 1, status: "drop", reason: "hallucination: function actually handles undefined" },
        ],
      }),
      model: "verifier-model",
    };
  };

  const candidates: FindingInput[] = [
    {
      ruleId: "llm/bug.real",
      ruleName: "Real Bug",
      category: "bug",
      severity: "high",
      message: "Real issue",
      locations: [{ path: "src/a.ts", startLine: 1 }],
      source: "llm",
    },
    {
      ruleId: "llm/bug.hallucinated",
      ruleName: "Fake Bug",
      category: "bug",
      severity: "medium",
      message: "Fake issue",
      locations: [{ path: "src/b.ts", startLine: 5 }],
      source: "llm",
    },
    {
      ruleId: "metrics/import-cycle",
      ruleName: "Probe Cycle",
      category: "structure",
      severity: "high",
      message: "Deterministic cycle",
      locations: [{ path: "src/a.ts", startLine: 1 }],
      source: "probe",
    },
  ];

  const context = buildContext(plantedRoot);
  const result = await verifyCandidateFindings(mockComplete, context, candidates);

  assert.equal(result.verified.length, 2);
  assert.equal(result.dropped.length, 1);
  assert.equal(result.dropped[0]?.finding.ruleId, "llm/bug.hallucinated");
  assert.match(result.dropped[0]?.reason ?? "", /hallucination/);
});
