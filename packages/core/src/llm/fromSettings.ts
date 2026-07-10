import { PanelSettings } from "../settings/types";
import { EmbeddingRuntimeConfig, LlmRuntimeConfig, normalizeBaseUrl } from "./types";

/** Tool LLM: summarize, rename, digests. */
export function llmConfigFromSettings(settings: PanelSettings): LlmRuntimeConfig | undefined {
  const apiKey = settings.llm.apiKey?.trim();
  const baseUrl = normalizeBaseUrl(settings.llm.baseUrl || "");
  const model = settings.llm.model?.trim();
  if (!apiKey || !baseUrl || !model) {
    return undefined;
  }

  return {
    baseUrl,
    model,
    apiKey,
    maxContextChars: settings.llm.maxContextChars,
    outputLanguage: settings.llm.outputLanguage
  };
}

/**
 * Conversation / Meta-Agent model.
 * Per-field fallback to tool `llm`; outputLanguage / maxContextChars always from tool llm.
 */
export function chatLlmConfigFromSettings(settings: PanelSettings): LlmRuntimeConfig | undefined {
  const chat = settings.chatLlm;
  const apiKey = (chat?.apiKey || settings.llm.apiKey)?.trim();
  const baseUrl = normalizeBaseUrl(chat?.baseUrl || settings.llm.baseUrl || "");
  const model = (chat?.model || settings.llm.model)?.trim();
  if (!apiKey || !baseUrl || !model) {
    return undefined;
  }

  return {
    baseUrl,
    model,
    apiKey,
    maxContextChars: settings.llm.maxContextChars,
    outputLanguage: settings.llm.outputLanguage
  };
}

export function embeddingConfigFromSettings(settings: PanelSettings): EmbeddingRuntimeConfig | undefined {
  const apiKey = (settings.embedding.apiKey || settings.llm.apiKey)?.trim();
  const baseUrl = normalizeBaseUrl(settings.embedding.baseUrl || settings.llm.baseUrl || "");
  const model = settings.embedding.model?.trim();
  if (!apiKey || !baseUrl || !model) {
    return undefined;
  }

  return { baseUrl, model, apiKey };
}
