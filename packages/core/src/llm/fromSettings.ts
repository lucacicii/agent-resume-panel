import { resolveEffectiveOutputLanguage } from "../i18n/outputLanguage";
import type { AiProvider, ModelKind, ModelSelection, ModelUse } from "../providers/types";
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

function findFirstValidModel(
  settings: PanelSettings,
  kind: ModelKind
): { provider: AiProvider; modelId: string } | undefined {
  for (const provider of settings.providers ?? []) {
    if (!provider.baseUrl?.trim() || !provider.apiKey?.trim()) continue;
    for (const model of provider.models ?? []) {
      if (model.kind === kind && model.id.trim()) {
        return { provider, modelId: model.id.trim() };
      }
    }
  }
  return undefined;
}

/** Resolve a use case's selected model to its provider + model id. Falls back to pool defaults. */
export function resolveSelectedModel(
  settings: PanelSettings,
  use: ModelUse
): { provider: AiProvider; modelId: string } | undefined {
  const selection: ModelSelection | undefined = settings.modelSelections?.[use];
  if (selection?.providerId && selection?.modelId) {
    const provider = findProvider(settings, selection.providerId);
    if (provider) {
      const model = (provider.models ?? []).find((entry) => entry.id === selection.modelId);
      if (model) {
        return { provider, modelId: model.id };
      }
    }
  }
  if (
    use === "gitCommit" ||
    use === "sessionRename" ||
    use === "sessionSummary" ||
    use === "report" ||
    use === "gtd"
  ) {
    return resolveSelectedModel(settings, "tool");
  }
  if (use === "imRouting") {
    return resolveSelectedModel(settings, "chat");
  }
  if (use === "chat") {
    return resolveSelectedModel(settings, "tool") ?? findFirstValidModel(settings, "text");
  }
  if (use === "tool") {
    return findFirstValidModel(settings, "text");
  }
  if (use === "embedding") {
    return findFirstValidModel(settings, "embedding");
  }
  if (use === "image") {
    return findFirstValidModel(settings, "image");
  }
  return undefined;
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

export type SpecializedModelUse =
  | "gitCommit"
  | "sessionRename"
  | "sessionSummary"
  | "report"
  | "gtd"
  | "imRouting";

export const SPECIALIZED_MODEL_USES: readonly SpecializedModelUse[] = [
  "gitCommit",
  "sessionRename",
  "sessionSummary",
  "report",
  "gtd",
  "imRouting"
] as const;

export function isSpecializedModelUse(use: ModelUse): use is SpecializedModelUse {
  return (
    use === "gitCommit" ||
    use === "sessionRename" ||
    use === "sessionSummary" ||
    use === "report" ||
    use === "gtd" ||
    use === "imRouting"
  );
}

/** General helper to build an LLM runtime config for any ModelUse scenario. */
export function llmConfigForUse(
  settings: PanelSettings,
  use: ModelUse,
  systemLocale?: string
): LlmRuntimeConfig | undefined {
  const resolved = resolveSelectedModel(settings, use);
  if (!resolved) return undefined;
  const apiKey = resolved.provider.apiKey?.trim();
  const baseUrl = normalizeBaseUrl(resolved.provider.baseUrl);
  const model = resolved.modelId?.trim();
  if (!apiKey || !baseUrl || !model) {
    return undefined;
  }
  const toolOptions = settings.llmOptions?.tool;
  // Specialized feature models default to disableThinking: true to prevent reasoning models
  // from burning max_tokens budget on deterministic batch/auxiliary tasks.
  const disableThinking = isSpecializedModelUse(use)
    ? (settings.llmOptions?.[use]?.disableThinking ?? true)
    : use === "chat"
      ? (settings.llmOptions?.chat?.disableThinking ?? toolOptions?.disableThinking)
      : toolOptions?.disableThinking;
  return {
    baseUrl,
    model,
    apiKey,
    maxContextChars: toolOptions?.maxContextChars,
    outputLanguage: resolvedOutputLanguage(settings, systemLocale),
    requestTimeoutMs: toolOptions?.requestTimeoutMs,
    disableThinking
  };
}

/** Tool LLM: default for summarize, rename, digests. Prefer a fast, low-cost model. */
export function llmConfigFromSettings(
  settings: PanelSettings,
  systemLocale?: string
): LlmRuntimeConfig | undefined {
  return llmConfigForUse(settings, "tool", systemLocale);
}

/**
 * Conversation / Meta-Agent model. Falls back to the tool selection when chat
 * is not configured; options come from the tool `llmOptions` where shared.
 */
export function chatLlmConfigFromSettings(
  settings: PanelSettings,
  systemLocale?: string
): LlmRuntimeConfig | undefined {
  return llmConfigForUse(settings, "chat", systemLocale);
}

/** Git commit message generation model. Falls back to tool selection when unset. */
export function gitCommitLlmConfigFromSettings(
  settings: PanelSettings,
  systemLocale?: string
): LlmRuntimeConfig | undefined {
  return llmConfigForUse(settings, "gitCommit", systemLocale);
}

/** Session auto-rename / suggested title model. Falls back to tool selection when unset. */
export function sessionRenameLlmConfigFromSettings(
  settings: PanelSettings,
  systemLocale?: string
): LlmRuntimeConfig | undefined {
  return llmConfigForUse(settings, "sessionRename", systemLocale);
}

/** Session summary generation model. Falls back to tool selection when unset. */
export function sessionSummaryLlmConfigFromSettings(
  settings: PanelSettings,
  systemLocale?: string
): LlmRuntimeConfig | undefined {
  return llmConfigForUse(settings, "sessionSummary", systemLocale);
}

/** Daily, weekly, monthly report digests model. Falls back to tool selection when unset. */
export function reportLlmConfigFromSettings(
  settings: PanelSettings,
  systemLocale?: string
): LlmRuntimeConfig | undefined {
  return llmConfigForUse(settings, "report", systemLocale);
}

/** GTD action item analysis model. Falls back to tool selection when unset. */
export function gtdLlmConfigFromSettings(
  settings: PanelSettings,
  systemLocale?: string
): LlmRuntimeConfig | undefined {
  return llmConfigForUse(settings, "gtd", systemLocale);
}

/** IM message smart intent routing model. Falls back to chat selection when unset. */
export function imRoutingLlmConfigFromSettings(
  settings: PanelSettings,
  systemLocale?: string
): LlmRuntimeConfig | undefined {
  return llmConfigForUse(settings, "imRouting", systemLocale);
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