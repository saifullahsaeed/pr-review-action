import test from "node:test";
import assert from "node:assert/strict";
import { renderHtml } from "../src/render/html.ts";
import type { Report } from "../src/findings.ts";

test("HTML rendering produces valid HTML with filter components and finding cards", () => {
  const report: Report = {
    schemaVersion: "1.0.0",
    tool: { name: "harrier", version: "0.1.0" },
    target: { root: "/workspace/test" },
    startedAt: "2026-09-30T12:00:00.000Z",
    finishedAt: "2026-09-30T12:01:00.000Z",
    summary: {
      total: 1,
      bySeverity: { critical: 0, high: 1, medium: 0, low: 0, info: 0 },
      byCategory: { bug: 1, quality: 0, structure: 0, security: 0, secret: 0, dependency: 0 },
      bySource: { llm: 1, probe: 0 },
    },
    probes: [
      { probe: "llm/bug", categories: ["bug"], status: "ok" },
    ],
    findings: [
      {
        id: "test-finding-1",
        fingerprint: "test-fp-1",
        ruleId: "llm/bug.auth",
        ruleName: "Authorization Bypass",
        category: "bug",
        severity: "high",
        message: "Missing token validation",
        locations: [{ path: "src/auth.ts", startLine: 10, endLine: 15 }],
        source: "llm",
        confidence: "high",
        fixHint: "Validate token before proceeding",
      },
    ],
    overview: "One authorization bug found.",
  };

  const html = renderHtml(report);
  assert.ok(html.includes("<!DOCTYPE html>"));
  assert.ok(html.includes("Harrier Code Review"));
  assert.ok(html.includes("/workspace/test"));
  assert.ok(html.includes("Authorization Bypass"));
  assert.ok(html.includes("One authorization bug found."));
  assert.ok(html.includes("src/auth.ts"));
  assert.ok(html.includes("filter-severity"));
  assert.ok(html.includes("filter-category"));
});
