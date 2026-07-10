export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmRuntimeConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  maxContextChars?: number;
  outputLanguage?: string;
  /** Maximum time to wait for one chat completion request. */
  requestTimeoutMs?: number;
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
