import { mkdirSync, writeFileSync } from "node:fs";
import { renderJson } from "../src/render/json.ts";
import { renderMarkdown } from "../src/render/markdown.ts";
import { renderSarif } from "../src/render/sarif.ts";
import { fixtureReport } from "../tests/fixtures.ts";

const outDir = new URL("../tests/golden/", import.meta.url);
mkdirSync(outDir, { recursive: true });
const report = fixtureReport();
writeFileSync(new URL("report.json", outDir), renderJson(report));
writeFileSync(new URL("report.sarif.json", outDir), renderSarif(report));
writeFileSync(new URL("report.md", outDir), renderMarkdown(report));
console.log("goldens written to tests/golden/");
