/**
 * Command-line arguments. Kept out of cli.ts so the shape of the interface is testable
 * without spawning anything.
 */
import type { Category, Severity } from "./findings.ts";
import { CATEGORIES, SEVERITIES } from "./findings.ts";
import type { JudgementPass } from "./llm/prompts.ts";

export interface ReviewArgs {
  command: "review" | "help";
  root: string;
  out: string;
  categories?: Category[];
  minSeverity?: Severity;
  useLlm: boolean;
  endpoint?: string;
  model?: string;
  timeoutMs: number;
  offline: boolean;
  refreshDb: boolean;
  error?: string;
}

export const USAGE = `harrier — self-hosted code review

  harrier review <path> [options]

Options:
  --out <dir>          where the report goes (default: ./report)
  --categories <a,b>   only these categories: ${CATEGORIES.join(", ")}
  --severity <level>   minimum severity to include: ${SEVERITIES.join(", ")}
  --endpoint <url>     OpenAI-compatible base URL for the judgement passes
  --model <id>         model id (default: from HARRIER_LLM_MODEL)
  --no-llm             probes only; no code leaves the machine
  --offline            nothing phones home: advisory lookups from the mirrored database,
                       judgement passes off unless --endpoint points at a local model
  --refresh-db         download/update the mirrored vulnerability database first
  --timeout <ms>       per-scanner timeout (default: 120000)

Writes report.json (canonical, machine-readable), report.sarif (SARIF 2.1.0) and report.md.
Exit 0 once the review is written. Findings are not an error; they are the product.
`;

function listOf(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

export function parseReviewArgs(argv: readonly string[]): ReviewArgs {
  const args: ReviewArgs = {
    command: "help",
    root: "",
    out: "./report",
    useLlm: true,
    timeoutMs: 120000,
    offline: false,
    refreshDb: false,
  };
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    switch (token) {
      case "--out":
        if (next === undefined) return { ...args, error: "--out needs a directory" };
        args.out = next;
        index += 1;
        break;
      case "--categories": {
        if (next === undefined) return { ...args, error: "--needs a list" };
        const values = listOf(next);
        for (const value of values) {
          if (!(CATEGORIES as readonly string[]).includes(value)) {
            return { ...args, error: `unknown category: ${value}` };
          }
        }
        args.categories = values as Category[];
        index += 1;
        break;
      }
      case "--severity": {
        if (next === undefined) return { ...args, error: "--severity needs a level" };
        if (!(SEVERITIES as readonly string[]).includes(next)) {
          return { ...args, error: `unknown severity: ${next}` };
        }
        args.minSeverity = next as Severity;
        index += 1;
        break;
      }
      case "--endpoint":
        if (next === undefined) return { ...args, error: "--endpoint needs a URL" };
        args.endpoint = next;
        index += 1;
        break;
      case "--model":
        if (next === undefined) return { ...args, error: "--model needs an id" };
        args.model = next;
        index += 1;
        break;
      case "--timeout":
        if (next === undefined) return { ...args, error: "--timeout needs milliseconds" };
        args.timeoutMs = Number(next);
        index += 1;
        break;
      case "--no-llm":
        args.useLlm = false;
        break;
      case "--offline":
        args.offline = true;
        break;
      case "--refresh-db":
        args.refreshDb = true;
        break;
      case "--help":
      case "-h":
        args.command = "help";
        return args;
      default:
        if (token !== undefined && token.startsWith("--")) {
          return { ...args, error: `unknown flag: ${token}` };
        }
        if (token !== undefined) positional.push(token);
    }
  }

  const [command, root] = positional;
  if (command !== "review") {
    return { ...args, error: `expected "review", got ${command ?? "nothing"}` };
  }
  if (root === undefined) {
    return { ...args, error: "review needs a path to review" };
  }
  args.command = "review";
  args.root = root;
  if (args.offline && args.endpoint === undefined) args.useLlm = false;
  return args;
}

export const PASSES: JudgementPass[] = ["structure", "quality", "bug"];
