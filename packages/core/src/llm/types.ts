export interface ToolFunctionSpec {
  name: string;
  description?: string;
  parameters: object;
}

export interface ToolDefinition {
  type: "function";
  function: ToolFunctionSpec;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Present on assistant messages that requested tool calls. */
  tool_calls?: ToolCall[];
  /** Present on tool-role messages that respond to a specific tool call. */
  tool_call_id?: string;
  /** Name of the tool, present on tool-role messages. */
  name?: string;
}

export interface LlmRuntimeConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  maxContextChars?: number;
  outputLanguage?: string;
  /** Maximum time to wait for one chat completion request. */
  requestTimeoutMs?: number;
  /** Send `thinking: { type: "disabled" }` to disable reasoning (DeepSeek/Qwen/GLM). */
  disableThinking?: boolean;
}

export const DEFAULT_LLM_REQUEST_TIMEOUT_MS = 300_000;

export interface EmbeddingRuntimeConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

export function buildChatCompletionsUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  if (normalized.endsWith("/chat/completions")) {
    return normalized;
  }
  return `${normalized}/chat/completions`;
}

export function buildEmbeddingsUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  if (normalized.endsWith("/embeddings")) {
    return normalized;
  }
  return `${normalized}/embeddings`;
}
