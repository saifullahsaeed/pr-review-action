#!/usr/bin/env node
import { parseReviewArgs, PASSES, USAGE } from "./args.ts";
import { loadConfigFile } from "./config.ts";
import { complete } from "./llm/client.ts";
import type { ChatMessage } from "./llm/client.ts";
import type { LlmConfig } from "./llm/config.ts";
import { configFromEnv } from "./llm/config.ts";
import { review, DEFAULT_PROBES } from "./pipeline.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { HarrierConfig } from "./config.ts";
import { validateGatePolicy } from "./gate.ts";
import { qualityReview } from "./quality.ts";
import { validateBatchBudget } from "./llm/batches.ts";
import { validateEnforcementPolicy } from "./rules/policy.ts";

function makeComplete(config: LlmConfig): (messages: ChatMessage[]) => Promise<{ content: string; model: string }> {
  return (messages) => complete(config, messages);
}

const args = parseReviewArgs(process.argv.slice(2));

if (args.command === "help") {
  console.log(USAGE);
  process.exit(args.error === undefined ? 0 : 2);
}
if (args.error !== undefined) {
  console.error(`${args.error}\n`);
  console.error(USAGE);
  process.exit(2);
}

let fileConfig: HarrierConfig | undefined;
let gatePolicy;
let budget;
let enforcement;
try {
  fileConfig = args.policyFile ? JSON.parse(readFileSync(args.policyFile, "utf8")) as HarrierConfig : loadConfigFile(args.root, args.configPath);
  if (fileConfig !== undefined && (!fileConfig || typeof fileConfig !== "object" || Array.isArray(fileConfig))) throw new Error("configuration must be an object");
  gatePolicy = validateGatePolicy(fileConfig?.gate);
  budget = validateBatchBudget(fileConfig?.budget);
  // With a baseline, enforcement is loaded from the trusted revision by qualityReview.
  enforcement = args.baselineRef ? undefined : validateEnforcementPolicy(fileConfig?.enforcement);
  if (args.failOn !== undefined) gatePolicy = { ...gatePolicy, failOn: args.failOn };
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}

const effectiveCategories = args.categories ?? fileConfig?.categories;
const effectiveSeverity = args.minSeverity ?? fileConfig?.minSeverity;
const effectiveOut = args.out !== "./report" ? args.out : (fileConfig?.outDir ?? args.out);
const effectiveTimeout = args.timeoutMs !== 120000 ? args.timeoutMs : (fileConfig?.timeoutMs ?? args.timeoutMs);
const effectiveUseLlm = args.useLlm && (fileConfig?.useLlm !== false);
const effectivePasses = fileConfig?.passes ?? PASSES;

const env = configFromEnv({
  ...process.env,
  ...(fileConfig?.endpoint !== undefined ? { HARRIER_LLM_BASE_URL: fileConfig.endpoint } : {}),
  ...(fileConfig?.model !== undefined ? { HARRIER_LLM_MODEL: fileConfig.model } : {}),
  ...(args.endpoint !== undefined ? { HARRIER_LLM_BASE_URL: args.endpoint } : {}),
  ...(args.model !== undefined ? { HARRIER_LLM_MODEL: args.model } : {}),
});

// No endpoint is a gap to report, not a crash: the review runs without the judgement passes and
// says so, exactly as it does for a scanner that is not installed.
let llmSkippedNote: string | undefined;
let completeFn: ReturnType<typeof makeComplete> | undefined;
if (!effectiveUseLlm) {
  llmSkippedNote = "judgement passes disabled (--no-llm or config)";
} else if (env.config === undefined) {
  llmSkippedNote = `no model endpoint configured (${env.missing.join(", ")}) — judgement passes did not run`;
} else {
  completeFn = makeComplete(env.config);
}

const started = Date.now();
// Combine rules instructions and custom bullet rules into plain English text
const customRulesList = fileConfig?.rules?.custom ?? [];
const customInstructions = [
  fileConfig?.rules?.instructions,
  customRulesList.length > 0 ? "Specific rules to enforce strictly:\n" + customRulesList.map((r) => `- ${r}`).join("\n") : undefined,
].filter(Boolean).join("\n\n");

const options = {
  root: resolve(args.root),
  budget,
  ...(enforcement ? { enforcement } : {}),
  ...(args.evidenceFile ? { evidenceFile: args.evidenceFile } : {}),
  ...(args.safeScanners ? { probes: DEFAULT_PROBES.filter(p => p.name !== "eslint") } : {}),
  outDir: effectiveOut,
  ...(effectiveCategories !== undefined ? { categories: effectiveCategories } : {}),
  ...(effectiveSeverity !== undefined ? { minSeverity: effectiveSeverity } : {}),
  timeoutMs: effectiveTimeout,
  probeOptions: { osvMode: args.refreshDb ? "refresh" : args.offline ? "offline" : "online" },
  ...(args.diffRef !== undefined ? { diffRef: args.diffRef } : {}),
  ...(customInstructions ? { customInstructions } : {}),
  ...(completeFn !== undefined ? { complete: completeFn, passes: effectivePasses } : {}),
  ...(llmSkippedNote !== undefined ? { llmSkippedNote } : {}),
};
const artifacts = args.gate || enforcement ? await qualityReview(options, gatePolicy, args.baselineRef) : await review(options);

const { summary, probes = [] } = artifacts.report;
const skipped = probes.filter((run) => run.status !== "ok");
console.log(
  [
    `harrier reviewed ${args.root} in ${Date.now() - started}ms`,
    `  ${summary.total} finding(s) — ${summary.bySeverity.critical} critical, ${summary.bySeverity.high} high, ${summary.bySeverity.medium} medium, ${summary.bySeverity.low} low, ${summary.bySeverity.info} info`,
    `  probes: ${probes.map((run) => `${run.probe}=${run.status}`).join(" ")}`,
    ...(skipped.length > 0
      ? [`  not covered: ${skipped.map((run) => `${run.probe} (${run.status})`).join(", ")}`]
      : []),
    `  wrote ${artifacts.paths.json}`,
    `        ${artifacts.paths.sarif}`,
    `        ${artifacts.paths.markdown}`,
    `        ${artifacts.paths.html}`,
  ].join("\n"),
);
if (artifacts.report.gate) {
  console.log(`  quality gate: ${artifacts.report.gate.status}`);
  process.exitCode = artifacts.report.gate.exitCode;
}
