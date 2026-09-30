#!/usr/bin/env node
import { parseReviewArgs, PASSES, USAGE } from "./args.ts";
import { loadConfigFile } from "./config.ts";
import { complete } from "./llm/client.ts";
import type { ChatMessage } from "./llm/client.ts";
import type { LlmConfig } from "./llm/config.ts";
import { configFromEnv } from "./llm/config.ts";
import { review } from "./pipeline.ts";

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

const fileConfig = loadConfigFile(args.root, args.configPath);

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
const artifacts = await review({
  root: args.root,
  outDir: effectiveOut,
  ...(effectiveCategories !== undefined ? { categories: effectiveCategories } : {}),
  ...(effectiveSeverity !== undefined ? { minSeverity: effectiveSeverity } : {}),
  timeoutMs: effectiveTimeout,
  probeOptions: { osvMode: args.refreshDb ? "refresh" : args.offline ? "offline" : "online" },
  ...(args.diffRef !== undefined ? { diffRef: args.diffRef } : {}),
  ...(completeFn !== undefined ? { complete: completeFn, passes: effectivePasses } : {}),
  ...(llmSkippedNote !== undefined ? { llmSkippedNote } : {}),
});

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
