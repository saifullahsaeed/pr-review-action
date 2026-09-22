import type { LlmConfig } from "./config.ts";

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface ChatResult {
  content: string;
  model: string;
}

/**
 * Minimal OpenAI-compatible chat client: the same interface OpenRouter, vLLM and Ollama speak,
 * which is the whole point of the self-hosted shape.
 */
export async function complete(config: LlmConfig, messages: ChatMessage[]): Promise<ChatResult> {
  const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LLM endpoint returned ${response.status}: ${body.slice(0, 300)}`);
  }
  const data = (await response.json()) as {
    model?: string;
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new Error("LLM response carried no message content");
  }
  return { content, model: data.model ?? config.model };
}
