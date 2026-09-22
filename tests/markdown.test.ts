import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { renderMarkdown } from "../src/render/markdown.ts";
import { buildReport } from "../src/report.ts";
import { fixtureReport } from "./fixtures.ts";

test("Markdown rendering matches the golden file", () => {
  const golden = readFileSync(new URL("./golden/report.md", import.meta.url), "utf8");
  assert.equal(renderMarkdown(fixtureReport()), golden);
});

test("Markdown names the target, the counts and the locations", () => {
  const markdown = renderMarkdown(fixtureReport());
  assert.match(markdown, /# Harrier review — `fixtures\/planted`/);
  assert.match(markdown, /\*\*8 findings\*\*/);
  assert.match(markdown, /`src\/config\.ts:12`/);
  assert.match(markdown, /_fix:_ Rotate the key/);
});

test("an empty review renders an explicit clean report", () => {
  const { report } = buildReport({
    tool: { name: "harrier", version: "0.1.0" },
    target: { root: "fixtures/clean" },
    startedAt: "2026-09-22T10:00:00.000Z",
    finishedAt: "2026-09-22T10:00:04.000Z",
    findings: [],
  });
  const markdown = renderMarkdown(report);
  assert.match(markdown, /\*\*0 findings\*\*/);
  assert.match(markdown, /_No findings\._/);
});
