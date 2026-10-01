import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Category, Severity } from "./findings.ts";
import type { JudgementPass } from "./llm/prompts.ts";
import type { GatePolicy } from "./gate.ts";

export interface HarrierConfig {
  gate?: Partial<GatePolicy>;
  categories?: Category[];
  minSeverity?: Severity;
  outDir?: string;
  passes?: JudgementPass[];
  timeoutMs?: number;
  useLlm?: boolean;
  endpoint?: string;
  model?: string;
  offline?: boolean;
  budget?: {
    maxFiles?: number;
    maxLinesPerFile?: number;
    maxTotalLines?: number;
  };
  ignore?: string[];
  rules?: {
    enable?: string[];
    disable?: string[];
    instructions?: string;
    custom?: string[];
  };
}

export const CONFIG_FILENAMES = [
  "harrier.config.json",
  ".harrier.json",
  ".harrier.config.json",
];

export function loadConfigFile(root: string, customConfigPath?: string): HarrierConfig | undefined {
  if (customConfigPath) {
    const full = join(root, customConfigPath);
    if (existsSync(full)) {
      try {
        return JSON.parse(readFileSync(full, "utf8")) as HarrierConfig;
      } catch (e) {
        throw new Error(`Failed to parse custom config at ${customConfigPath}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  for (const name of CONFIG_FILENAMES) {
    const full = join(root, name);
    if (existsSync(full)) {
      try {
        return JSON.parse(readFileSync(full, "utf8")) as HarrierConfig;
      } catch (e) {
        throw new Error(`Failed to parse config file at ${name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  return undefined;
}
