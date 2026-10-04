import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { ChatMessage, ChatResult } from "./client.ts";
export interface TokenBudget { maxInputTokens: number; reservedTokens: number }
export function validateTokenBudget(value: unknown): TokenBudget | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("tokenBudget must be an object");
  const b = value as Record<string, unknown>;
  if (Object.keys(b).some(k => !["maxInputTokens", "reservedTokens"].includes(k))) throw new Error("Unknown tokenBudget field");
  const reserved = b.reservedTokens ?? 256;
  if (!Number.isSafeInteger(b.maxInputTokens) || (b.maxInputTokens as number) < 1 || !Number.isSafeInteger(reserved) || (reserved as number) < 0 || (reserved as number) >= (b.maxInputTokens as number)) throw new Error("Invalid token budget or overhead reserve");
  return { maxInputTokens: b.maxInputTokens as number, reservedTokens: reserved as number };
}
/** Exact content BPE count; chat-template/server overhead is separately reserved, never called exact. */
export function countTextTokens(model: string, messages: ChatMessage[]): number {
  const result = spawnSync("python3", ["-I", fileURLToPath(new URL("./count_tokens.py", import.meta.url))], {
    input: JSON.stringify({ model, messages }), encoding: "utf8", timeout: 10000, maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error(`Token coverage incomplete: ${result.error?.message ?? result.stdout ?? result.stderr}`);
  const data = JSON.parse(result.stdout) as { textTokens?: number };
  if (!Number.isSafeInteger(data.textTokens) || data.textTokens! < 0) throw new Error("Invalid tokenizer output");
  return data.textTokens!;
}
export function tokenBoundedComplete(
  model: string, budget: TokenBudget,
  complete: (messages: ChatMessage[]) => Promise<ChatResult>,
  count: (model: string, messages: ChatMessage[]) => number = countTextTokens,
): (messages: ChatMessage[]) => Promise<ChatResult> {
  return async messages => {
    const tokens = count(model, messages);
    if (tokens + budget.reservedTokens > budget.maxInputTokens) throw new Error(`Token coverage incomplete: ${tokens} exact text tokens + ${budget.reservedTokens} reserved overhead exceeds ${budget.maxInputTokens}; reduce batch/context limits`);
    return complete(messages);
  };
}
