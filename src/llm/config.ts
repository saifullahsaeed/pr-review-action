/**
 * Endpoint configuration. The team points Harrier at whatever OpenAI-compatible endpoint they
 * run — OpenRouter, vLLM, Ollama — and the key never lives in this repo.
 */
export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
/** The cheap model on the owner's own list (~/claude-openrouter.conf, 11 Sep 2026 pricing). */
export const DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash";

export function configFromEnv(
  env: Record<string, string | undefined> = process.env,
): { config?: LlmConfig; missing: string[] } {
  const apiKey = env.HARRIER_LLM_API_KEY ?? env.OPENROUTER_API_KEY;
  const missing: string[] = [];
  if (apiKey === undefined || apiKey === "") missing.push("HARRIER_LLM_API_KEY (or OPENROUTER_API_KEY)");
  if (missing.length > 0) return { missing };
  return {
    config: {
      baseUrl: env.HARRIER_LLM_BASE_URL ?? DEFAULT_BASE_URL,
      apiKey: apiKey as string,
      model: env.HARRIER_LLM_MODEL ?? DEFAULT_MODEL,
      timeoutMs: Number(env.HARRIER_LLM_TIMEOUT_MS ?? 120000),
    },
    missing,
  };
}
