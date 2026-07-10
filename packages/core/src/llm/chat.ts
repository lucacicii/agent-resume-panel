import { buildChatCompletionsUrl, ChatMessage, LlmRuntimeConfig } from "./types";
import { parseOpenAiUsage, TokenUsage } from "../usage/types";

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  model?: string;
  usage?: unknown;
  error?: {
    message?: string;
  };
}

export interface LlmCallResult {
  content: string;
  usage?: TokenUsage;
  model?: string;
  durationMs: number;
}

export async function chatCompletionDetailed(
  config: LlmRuntimeConfig,
  messages: ChatMessage[],
  maxTokens = 1024
): Promise<LlmCallResult> {
  const url = buildChatCompletionsUrl(config.baseUrl);
  const started = Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      max_tokens: maxTokens,
      temperature: 0.2
    }),
    signal: AbortSignal.timeout(120_000)
  });

  let payload: ChatCompletionResponse;
  try {
    payload = (await response.json()) as ChatCompletionResponse;
  } catch {
    throw new Error(`LLM request failed with status ${response.status}.`);
  }

  const durationMs = Date.now() - started;

  if (!response.ok) {
    const message = payload.error?.message || `LLM request failed with status ${response.status}.`;
    throw new Error(`${message} (endpoint: ${url})`);
  }

  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("LLM returned an empty response.");
  }

  return {
    content,
    usage: parseOpenAiUsage(payload.usage),
    model: payload.model || config.model,
    durationMs
  };
}

export async function chatCompletion(
  config: LlmRuntimeConfig,
  messages: ChatMessage[],
  maxTokens = 1024
): Promise<string> {
  const result = await chatCompletionDetailed(config, messages, maxTokens);
  return result.content;
}
