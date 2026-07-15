import { resolveEffectiveOutputLanguage } from "../i18n/outputLanguage";
import { PanelSettings } from "../settings/types";
import { EmbeddingRuntimeConfig, LlmRuntimeConfig, normalizeBaseUrl } from "./types";

function resolvedOutputLanguage(settings: PanelSettings, systemLocale?: string): string {
  return resolveEffectiveOutputLanguage({
    outputPreference: settings.llm.outputLanguage,
    uiPreference: settings.uiLanguage,
    systemLocale
  }).catalogLanguage;
}

/** Tool LLM: summarize, rename, digests. */
export function llmConfigFromSettings(
  settings: PanelSettings,
  systemLocale?: string
): LlmRuntimeConfig | undefined {
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
    outputLanguage: resolvedOutputLanguage(settings, systemLocale),
    requestTimeoutMs: settings.llm.requestTimeoutMs
  };
}

/**
 * Conversation / Meta-Agent model.
 * Per-field fallback to tool `llm`; outputLanguage / maxContextChars always from tool llm.
 */
export function chatLlmConfigFromSettings(
  settings: PanelSettings,
  systemLocale?: string
): LlmRuntimeConfig | undefined {
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
    outputLanguage: resolvedOutputLanguage(settings, systemLocale),
    requestTimeoutMs: settings.llm.requestTimeoutMs
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