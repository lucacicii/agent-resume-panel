import {
  buildChatCompletionsUrl,
  ChatMessage,
  DEFAULT_LLM_REQUEST_TIMEOUT_MS,
  LlmRuntimeConfig
} from "./types";
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
  const configuredTimeout = Number(config.requestTimeoutMs);
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? Math.max(1_000, Math.floor(configuredTimeout))
    : DEFAULT_LLM_REQUEST_TIMEOUT_MS;
  let response: Response;
  try {
    response = await fetch(url, {
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
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error(`LLM request timed out after ${Math.round(timeoutMs / 1000)}s (endpoint: ${url}).`);
    }
    throw error;
  }

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

export interface ChatStreamCallbacks {
  onChunk?: (delta: string) => void | Promise<void>;
}

interface StreamChunkPayload {
  choices?: Array<{
    delta?: {
      content?: string;
    };
  }>;
  model?: string;
  usage?: unknown;
  error?: {
    message?: string;
  };
}

function llmRequestTimeoutMs(config: LlmRuntimeConfig): number {
  const configuredTimeout = Number(config.requestTimeoutMs);
  return Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? Math.max(1_000, Math.floor(configuredTimeout))
    : DEFAULT_LLM_REQUEST_TIMEOUT_MS;
}

async function readLlmErrorMessage(response: Response, url: string): Promise<string> {
  try {
    const payload = (await response.json()) as ChatCompletionResponse;
    return payload.error?.message || `LLM request failed with status ${response.status}. (endpoint: ${url})`;
  } catch {
    return `LLM request failed with status ${response.status}. (endpoint: ${url})`;
  }
}

export async function chatCompletionStream(
  config: LlmRuntimeConfig,
  messages: ChatMessage[],
  maxTokens = 1024,
  callbacks?: ChatStreamCallbacks
): Promise<LlmCallResult> {
  const url = buildChatCompletionsUrl(config.baseUrl);
  const started = Date.now();
  const timeoutMs = llmRequestTimeoutMs(config);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        max_tokens: maxTokens,
        temperature: 0.2,
        stream: true
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error(`LLM request timed out after ${Math.round(timeoutMs / 1000)}s (endpoint: ${url}).`);
    }
    throw error;
  }

  if (!response.ok) {
    throw new Error(await readLlmErrorMessage(response, url));
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("LLM stream response has no body.");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let model: string | undefined;
  let usage: TokenUsage | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) {
        continue;
      }
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") {
        continue;
      }

      let payload: StreamChunkPayload;
      try {
        payload = JSON.parse(data) as StreamChunkPayload;
      } catch {
        continue;
      }

      if (payload.error?.message) {
        throw new Error(`${payload.error.message} (endpoint: ${url})`);
      }
      if (payload.model) {
        model = payload.model;
      }
      if (payload.usage) {
        usage = parseOpenAiUsage(payload.usage);
      }

      const delta = payload.choices?.[0]?.delta?.content;
      if (delta) {
        content += delta;
        if (callbacks?.onChunk) {
          await callbacks.onChunk(delta);
        }
      }
    }
  }

  const durationMs = Date.now() - started;
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("LLM returned an empty response.");
  }

  return {
    content: trimmed,
    usage,
    model: model || config.model,
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
