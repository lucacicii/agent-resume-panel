import { setTimeout as delay } from "node:timers/promises";
import { buildChatCompletionsUrl, LlmConfig } from "./config";
export { fetchAvailableModels } from "./models";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionOptions {
  /** Total attempts for transient transport failures (DNS, connect, reset). Defaults to 2. */
  attempts?: number;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
      reasoning_content?: string;
    };
    finish_reason?: string;
  }>;
  error?: {
    message?: string;
  };
}

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const MIN_REQUEST_TIMEOUT_MS = 5_000;
const MAX_REQUEST_TIMEOUT_MS = 600_000;
const DEFAULT_ATTEMPTS = 2;
const RETRY_BACKOFF_MS = 600;

/**
 * The request never produced a response (proxy closed the socket, connect
 * timeout, DNS failure). Retryable, unlike HTTP status and payload errors.
 */
class LlmNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmNetworkError";
  }
}

export function resolveRequestTimeoutMs(config: LlmConfig): number {
  const configured = config.requestTimeoutMs;
  if (Number.isFinite(configured) && configured > 0) {
    return Math.min(Math.max(configured, MIN_REQUEST_TIMEOUT_MS), MAX_REQUEST_TIMEOUT_MS);
  }
  return DEFAULT_REQUEST_TIMEOUT_MS;
}

export async function chatCompletion(
  config: LlmConfig,
  messages: ChatMessage[],
  maxTokens = 1024,
  options: ChatCompletionOptions = {}
): Promise<string> {
  const attempts = Math.max(1, Math.floor(options.attempts ?? DEFAULT_ATTEMPTS));
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await requestCompletion(config, messages, maxTokens);
    } catch (error) {
      // Timeouts are not retried: the endpoint had its full window already, and a
      // configured multi-minute timeout would turn one failure into several.
      if (!(error instanceof LlmNetworkError) || attempt >= attempts) {
        throw error;
      }
      await delay(RETRY_BACKOFF_MS * attempt);
    }
  }
}

async function requestCompletion(
  config: LlmConfig,
  messages: ChatMessage[],
  maxTokens: number
): Promise<string> {
  const url = buildChatCompletionsUrl(config.baseUrl);
  const timeoutMs = resolveRequestTimeoutMs(config);

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
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new Error(`LLM request timed out after ${timeoutMs}ms (endpoint: ${url})`);
    }
    throw new LlmNetworkError(
      `LLM request failed: ${describeNetworkError(error)} (endpoint: ${url})`
    );
  }

  let payload: ChatCompletionResponse;
  try {
    payload = (await response.json()) as ChatCompletionResponse;
  } catch {
    throw new Error(`LLM request failed with status ${response.status}.`);
  }

  if (!response.ok) {
    const message = payload.error?.message || `LLM request failed with status ${response.status}.`;
    throw new Error(`${message} (endpoint: ${url})`);
  }

  const choice = payload.choices?.[0];
  const content = choice?.message?.content?.trim();
  if (!content) {
    if (choice?.finish_reason === "length" || choice?.message?.reasoning_content) {
      throw new Error(
        "LLM returned an empty response: the output token limit was reached before any text was produced (common with reasoning models). Increase max_tokens or disable thinking mode."
      );
    }
    throw new Error("LLM returned an empty response.");
  }

  return content;
}

/**
 * undici reports every transport failure as `TypeError: fetch failed` and hides
 * the useful part in `error.cause`; without it the UI can only say "fetch
 * failed".
 */
function describeNetworkError(error: unknown): string {
  const detail = describeErrorDetail(error);
  if (!detail || detail === "fetch failed") {
    return "fetch failed (no transport detail reported; check network or proxy access to the endpoint)";
  }
  return detail;
}

function describeErrorDetail(error: unknown): string {
  if (error instanceof AggregateError && error.errors.length > 0) {
    const details = [...new Set(error.errors.map(describeErrorDetail).filter(Boolean))];
    if (details.length > 0) {
      return details.join("; ");
    }
  }

  if (error instanceof Error) {
    const code = "code" in error && typeof error.code === "string" ? error.code : "";
    const codeLabel = code && !error.message.includes(code) ? `${code} ` : "";
    const message = `${codeLabel}${error.message || error.name}`;
    const cause = "cause" in error ? error.cause : undefined;
    const nested = cause !== undefined && cause !== error ? describeErrorDetail(cause) : "";
    return nested && !message.includes(nested) ? `${message} (${nested})` : message;
  }

  if (typeof error === "string") {
    return error;
  }
  return "";
}
