import { resolveEffectiveOutputLanguage } from "../i18n/outputLanguage";
import type { AiProvider, ModelKind, ModelSelection } from "../providers/types";
import { PanelSettings } from "../settings/types";
import { EmbeddingRuntimeConfig, LlmRuntimeConfig, normalizeBaseUrl } from "./types";

/** One model from the provider pool, tagged with its owning provider. */
export interface PoolModelRef {
  providerId: string;
  providerName: string;
  modelId: string;
  kind: ModelKind;
}

export type PoolModelKind = ModelKind;

/** Enumerate every model of the given kind across the provider pool. */
export function listProviderModels(settings: PanelSettings, kind: ModelKind): PoolModelRef[] {
  const output: PoolModelRef[] = [];
  for (const provider of settings.providers ?? []) {
    for (const model of provider.models ?? []) {
      if (model.kind === kind) {
        output.push({
          providerId: provider.id,
          providerName: provider.name,
          modelId: model.id,
          kind: model.kind
        });
      }
    }
  }
  return output;
}

export function findProvider(settings: PanelSettings, providerId?: string): AiProvider | undefined {
  if (!providerId) return undefined;
  return (settings.providers ?? []).find((provider) => provider.id === providerId);
}

/** Resolve a use case's selected model to its provider + model id (pool lookup only). */
export function resolveSelectedModel(
  settings: PanelSettings,
  use: "tool" | "chat" | "embedding" | "image"
): { provider: AiProvider; modelId: string } | undefined {
  const selection: ModelSelection | undefined = settings.modelSelections?.[use];
  if (!selection?.providerId || !selection?.modelId) return undefined;
  const provider = findProvider(settings, selection.providerId);
  if (!provider) return undefined;
  const model = (provider.models ?? []).find((entry) => entry.id === selection.modelId);
  if (!model) return undefined;
  return { provider, modelId: model.id };
}

function resolvedOutputLanguage(settings: PanelSettings, systemLocale?: string): string {
  return resolveEffectiveOutputLanguage({
    outputPreference: settings.llmOptions?.tool?.outputLanguage,
    uiPreference: settings.uiLanguage,
    systemLocale
  }).catalogLanguage;
}

/** Tool LLM output-language preference (auto | locale). */
export function toolOutputLanguagePreference(settings: PanelSettings): string | undefined {
  return settings.llmOptions?.tool?.outputLanguage;
}

/** Tool LLM: summarize, rename, digests. Prefer a fast, low-cost model. */
export function llmConfigFromSettings(
  settings: PanelSettings,
  systemLocale?: string
): LlmRuntimeConfig | undefined {
  const resolved = resolveSelectedModel(settings, "tool");
  if (!resolved) return undefined;
  const apiKey = resolved.provider.apiKey?.trim();
  const baseUrl = normalizeBaseUrl(resolved.provider.baseUrl);
  const model = resolved.modelId?.trim();
  if (!apiKey || !baseUrl || !model) {
    return undefined;
  }
  const options = settings.llmOptions?.tool;
  return {
    baseUrl,
    model,
    apiKey,
    maxContextChars: options?.maxContextChars,
    outputLanguage: resolvedOutputLanguage(settings, systemLocale),
    requestTimeoutMs: options?.requestTimeoutMs,
    disableThinking: options?.disableThinking
  };
}

/**
 * Conversation / Meta-Agent model. Falls back to the tool selection when chat
 * is not configured; options come from the tool `llmOptions` where shared.
 */
export function chatLlmConfigFromSettings(
  settings: PanelSettings,
  systemLocale?: string
): LlmRuntimeConfig | undefined {
  const resolved = resolveSelectedModel(settings, "chat") ?? resolveSelectedModel(settings, "tool");
  if (!resolved) return undefined;
  const apiKey = resolved.provider.apiKey?.trim();
  const baseUrl = normalizeBaseUrl(resolved.provider.baseUrl);
  const model = resolved.modelId?.trim();
  if (!apiKey || !baseUrl || !model) {
    return undefined;
  }
  const toolOptions = settings.llmOptions?.tool;
  return {
    baseUrl,
    model,
    apiKey,
    maxContextChars: toolOptions?.maxContextChars,
    outputLanguage: resolvedOutputLanguage(settings, systemLocale),
    requestTimeoutMs: toolOptions?.requestTimeoutMs,
    disableThinking: settings.llmOptions?.chat?.disableThinking
  };
}

export function embeddingConfigFromSettings(settings: PanelSettings): EmbeddingRuntimeConfig | undefined {
  const resolved = resolveSelectedModel(settings, "embedding");
  if (!resolved) return undefined;
  const apiKey = resolved.provider.apiKey?.trim();
  const baseUrl = normalizeBaseUrl(resolved.provider.baseUrl);
  const model = resolved.modelId?.trim();
  if (!apiKey || !baseUrl || !model) {
    return undefined;
  }
  return { baseUrl, model, apiKey };
}