import {
  buildChatCompletionsUrl,
  ChatMessage,
  DEFAULT_LLM_REQUEST_TIMEOUT_MS,
  LlmRuntimeConfig,
  ToolCall,
  ToolDefinition
} from "./types";
import { parseOpenAiUsage, TokenUsage } from "../usage/types";

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning_content?: string;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason?: string;
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

export interface LlmToolCallResult extends LlmCallResult {
  toolCalls?: ToolCall[];
  finishReason?: string;
}

function llmRequestTimeoutMs(config: LlmRuntimeConfig): number {
  const configuredTimeout = Number(config.requestTimeoutMs);
  return Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? Math.max(1_000, Math.floor(configuredTimeout))
    : DEFAULT_LLM_REQUEST_TIMEOUT_MS;
}

/**
 * DeepSeek / Qwen / GLM reasoning models emit `reasoning_content` before content and can
 * consume the whole max_tokens budget on thinking, yielding an empty response on
 * deterministic batch tasks. Opt-in `thinking: { type: "disabled" }` turns that off.
 */
function thinkingBodyField(config: LlmRuntimeConfig): Record<string, unknown> {
  return config.disableThinking ? { thinking: { type: "disabled" } } : {};
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

function llmRequestSignal(timeoutMs: number, userSignal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!userSignal) {
    return timeoutSignal;
  }
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([timeoutSignal, userSignal]);
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  timeoutSignal.addEventListener("abort", onAbort, { once: true });
  userSignal.addEventListener("abort", onAbort, { once: true });
  return controller.signal;
}

function handleLlmFetchError(error: unknown, timeoutMs: number, url: string): never {
  if (error instanceof DOMException) {
    if (error.name === "AbortError") {
      throw error;
    }
    if (error.name === "TimeoutError") {
      throw new Error(`LLM request timed out after ${Math.round(timeoutMs / 1000)}s (endpoint: ${url}).`);
    }
  }
  throw error;
}

async function parseResponseBody(response: Response): Promise<{ rawText: string; payload: unknown }> {
  if (typeof response.text === "function") {
    try {
      const rawText = await response.text();
      try {
        return { rawText, payload: JSON.parse(rawText) };
      } catch {
        return { rawText, payload: undefined };
      }
    } catch {
      return { rawText: "", payload: undefined };
    }
  }
  if (typeof response.json === "function") {
    try {
      const payload = await response.json();
      return { rawText: JSON.stringify(payload), payload };
    } catch {
      return { rawText: "", payload: undefined };
    }
  }
  return { rawText: "", payload: undefined };
}

async function parseLlmErrorFromText(
  raw: string,
  payload: unknown,
  status: number,
  url: string,
  model?: string
): Promise<string> {
  let errorDetail = "";
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    const errObj = obj.error as Record<string, unknown> | string | undefined;
    if (typeof errObj === "string") {
      errorDetail = errObj;
    } else if (errObj && typeof errObj === "object" && typeof errObj.message === "string") {
      errorDetail = errObj.message;
    } else if (typeof obj.message === "string") {
      errorDetail = obj.message;
    } else if (typeof obj.detail === "string") {
      errorDetail = obj.detail;
    } else if (Array.isArray(obj.detail) && obj.detail[0]?.msg) {
      errorDetail = String(obj.detail[0].msg);
    }
  }
  if (!errorDetail && raw) {
    errorDetail = raw.trim().slice(0, 500);
  }
  const modelInfo = model ? ` (model: ${model})` : "";
  if (errorDetail) {
    return `${errorDetail} [HTTP ${status}] (endpoint: ${url}${modelInfo})`;
  }
  return `LLM request failed with status ${status}. (endpoint: ${url}${modelInfo})`;
}

async function readLlmErrorMessage(response: Response, url: string, model?: string): Promise<string> {
  const { rawText, payload } = await parseResponseBody(response);
  return parseLlmErrorFromText(rawText, payload, response.status, url, model);
}

export async function chatCompletionDetailed(
  config: LlmRuntimeConfig,
  messages: ChatMessage[],
  maxTokens = 1024,
  signal?: AbortSignal
): Promise<LlmCallResult> {
  const url = buildChatCompletionsUrl(config.baseUrl);
  const started = Date.now();
  const timeoutMs = llmRequestTimeoutMs(config);
  throwIfAborted(signal);
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
        ...thinkingBodyField(config)
      }),
      signal: llmRequestSignal(timeoutMs, signal)
    });
  } catch (error) {
    handleLlmFetchError(error, timeoutMs, url);
  }

  const { rawText, payload: rawPayload } = await parseResponseBody(response);
  if (!response.ok) {
    throw new Error(await parseLlmErrorFromText(rawText, rawPayload, response.status, url, config.model));
  }

  const payload = (rawPayload as ChatCompletionResponse | undefined) ?? (JSON.parse(rawText || "{}") as ChatCompletionResponse);

  const durationMs = Date.now() - started;

  const choice = payload.choices?.[0];
  const content = choice?.message?.content?.trim();
  if (!content) {
    if (choice?.finish_reason === "length" || choice?.message?.reasoning_content) {
      const details = payload.usage as
        | { completion_tokens_details?: { reasoning_tokens?: number } }
        | undefined;
      const reasoningTokens = details?.completion_tokens_details?.reasoning_tokens;
      throw new Error(
        `LLM returned an empty response: ${reasoningTokens ? `${reasoningTokens} of ${maxTokens} output tokens went to reasoning` : "the output token limit was reached before any text was produced"} (finish_reason=${choice?.finish_reason ?? "unknown"}, model=${payload.model || config.model}). Increase max_tokens or disable thinking mode.`
      );
    }
    throw new Error("LLM returned an empty response.");
  }

  return {
    content,
    usage: parseOpenAiUsage(payload.usage),
    model: payload.model || config.model,
    durationMs
  };
}

export async function chatCompletionWithTools(
  config: LlmRuntimeConfig,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  maxTokens = 1024,
  signal?: AbortSignal
): Promise<LlmToolCallResult> {
  const url = buildChatCompletionsUrl(config.baseUrl);
  const started = Date.now();
  const timeoutMs = llmRequestTimeoutMs(config);
  throwIfAborted(signal);
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
        tools,
        ...thinkingBodyField(config)
      }),
      signal: llmRequestSignal(timeoutMs, signal)
    });
  } catch (error) {
    handleLlmFetchError(error, timeoutMs, url);
  }

  const { rawText, payload: rawPayload } = await parseResponseBody(response);
  if (!response.ok) {
    throw new Error(await parseLlmErrorFromText(rawText, rawPayload, response.status, url, config.model));
  }

  const payload = (rawPayload as ChatCompletionResponse | undefined) ?? (JSON.parse(rawText || "{}") as ChatCompletionResponse);

  const durationMs = Date.now() - started;

  const choice = payload.choices?.[0];
  const content = choice?.message?.content?.trim() || "";
  const rawToolCalls = choice?.message?.tool_calls;

  return {
    content,
    toolCalls: rawToolCalls,
    finishReason: choice?.finish_reason,
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
    finish_reason?: string;
    delta?: {
      content?: string;
      reasoning_content?: string;
    };
  }>;
  model?: string;
  usage?: unknown;
  error?: {
    message?: string;
  };
}

export async function chatCompletionStream(
  config: LlmRuntimeConfig,
  messages: ChatMessage[],
  maxTokens = 1024,
  callbacks?: ChatStreamCallbacks,
  signal?: AbortSignal
): Promise<LlmCallResult> {
  const url = buildChatCompletionsUrl(config.baseUrl);
  const started = Date.now();
  const timeoutMs = llmRequestTimeoutMs(config);
  throwIfAborted(signal);
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
        stream: true,
        ...thinkingBodyField(config)
      }),
      signal: llmRequestSignal(timeoutMs, signal)
    });
  } catch (error) {
    handleLlmFetchError(error, timeoutMs, url);
  }

  if (!response.ok) {
    throw new Error(await readLlmErrorMessage(response, url, config.model));
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("LLM stream response has no body.");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let sawReasoning = false;
  let finishReason: string | undefined;
  let model: string | undefined;
  let usage: TokenUsage | undefined;

  while (true) {
    throwIfAborted(signal);
    const { done, value } = await reader.read();
    if (signal?.aborted) {
      await reader.cancel().catch(() => undefined);
      throw new DOMException("Aborted", "AbortError");
    }
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

      const choice = payload.choices?.[0];
      if (choice?.finish_reason) {
        finishReason = choice.finish_reason;
      }
      if (choice?.delta?.reasoning_content) {
        sawReasoning = true;
      }
      const delta = choice?.delta?.content;
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
    if (finishReason === "length" || sawReasoning) {
      throw new Error(
        "LLM returned an empty response: the output token limit was reached before any text was produced (common with reasoning models). Increase max_tokens or disable thinking mode."
      );
    }
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
