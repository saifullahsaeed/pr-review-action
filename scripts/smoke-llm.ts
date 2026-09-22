import { configFromEnv } from "../src/llm/config.ts";
import { complete } from "../src/llm/client.ts";
import { buildContext } from "../src/llm/context.ts";
import { runJudgement } from "../src/llm/judgement.ts";
import type { JudgementPass } from "../src/llm/prompts.ts";

/**
 * The live run. Point it at a directory and a pass, with the endpoint configured in the
 * environment (HARRIER_LLM_API_KEY or OPENROUTER_API_KEY, plus optional base URL and model).
 *
 *   node scripts/smoke-llm.ts tests/fixtures/smoke bug
 */
const target = process.argv[2] ?? new URL("../tests/fixtures/smoke/", import.meta.url).pathname;
const pass = (process.argv[3] ?? "bug") as JudgementPass;

const { config, missing } = configFromEnv();
if (config === undefined) {
  console.error(`missing configuration: ${missing.join(", ")}`);
  process.exit(2);
}

const context = buildContext(target);
const result = await runJudgement((messages) => complete(config, messages), context, [pass]);

console.log(
  JSON.stringify(
    {
      model: config.model,
      target,
      included: context.included,
      truncated: context.truncated,
      passes: result.passes,
      dropped: result.dropped.length,
      overview: result.overview,
      findings: result.findings,
    },
    null,
    2,
  ),
);
