import { normalizeOutputLanguagePreference } from "../i18n/outputLanguage";
import { normalizeBaseUrl } from "../llm/types";
import type { PanelSettings } from "../settings/types";
import {
  type AiProvider,
  type LlmUseOptions,
  type ModelKind,
  type ModelSelection,
  type ModelUse,
  MODEL_USES,
  normalizeProviderModel,
  normalizeSelection
} from "./types";

function providerNameFromBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  try {
    const host = new URL(trimmed).hostname;
    return host || trimmed;
  } catch {
    return trimmed;
  }
}

function pushModel(provider: AiProvider, modelId: string, kind: ModelKind): void {
  const id = modelId.trim();
  if (!id) return;
  if (!provider.models.some((model) => model.id === id)) {
    provider.models.push({ id, kind });
  }
}

function legacyLlmOptionsFrom(settings: PanelSettings): PanelSettings["llmOptions"] {
  const legacyTool = settings.llm;
  const tool: LlmUseOptions = {
    outputLanguage: normalizeOutputLanguagePreference(legacyTool.outputLanguage),
    maxContextChars: legacyTool.maxContextChars,
    requestTimeoutMs: legacyTool.requestTimeoutMs,
    disableThinking: legacyTool.disableThinking
  };
  return {
    tool,
    ...(typeof settings.chatLlm?.disableThinking === "boolean"
      ? { chat: { disableThinking: settings.chatLlm.disableThinking } }
      : {})
  };
}

/**
 * Normalize the provider pool and drop selections that reference a missing
 * provider or model. Structural only — never seeds new data.
 */
export function normalizeProviderPool(settings: PanelSettings): PanelSettings {
  const seen = new Set<string>();
  const providers: AiProvider[] = [];
  for (const raw of settings.providers ?? []) {
    if (!raw || typeof raw !== "object") continue;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!id || seen.has(id)) continue;
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    const baseUrl = typeof raw.baseUrl === "string" ? raw.baseUrl.trim() : "";
    if (!name || !baseUrl) continue;
    seen.add(id);
    const models: AiProvider["models"] = [];
    if (Array.isArray(raw.models)) {
      for (const model of raw.models) {
        const normalized = normalizeProviderModel(model);
        if (normalized && !models.some((existing) => existing.id === normalized.id)) {
          models.push(normalized);
        }
      }
    }
    providers.push({
      id,
      name,
      baseUrl,
      apiKey: typeof raw.apiKey === "string" ? raw.apiKey : undefined,
      models
    });
  }
  const modelSelections: Partial<Record<ModelUse, ModelSelection>> = {};
  for (const use of MODEL_USES) {
    const selection = normalizeSelection(settings.modelSelections?.[use]);
    if (!selection) continue;
    const provider = providers.find((entry) => entry.id === selection.providerId);
    if (!provider || !(provider.models ?? []).some((model) => model.id === selection.modelId)) {
      continue;
    }
    modelSelections[use] = selection;
  }
  const hasSelections = Object.keys(modelSelections).length > 0;
  return {
    ...settings,
    providers,
    modelSelections: hasSelections ? modelSelections : undefined,
    llmOptions: sanitizeLlmOptions(settings.llmOptions)
  };
}

function sanitizeLlmOptions(value: PanelSettings["llmOptions"] | undefined): PanelSettings["llmOptions"] {
  if (!value || typeof value !== "object") return undefined;
  const tool = value.tool && typeof value.tool === "object" ? value.tool : undefined;
  const chat = value.chat && typeof value.chat === "object" ? value.chat : undefined;
  if (!tool && !chat) return undefined;
  return {
    ...(tool
      ? {
          tool: {
            ...(typeof tool.outputLanguage === "string"
              ? { outputLanguage: normalizeOutputLanguagePreference(tool.outputLanguage) }
              : {}),
            ...(Number.isFinite(tool.maxContextChars)
              ? { maxContextChars: Math.max(4_000, Math.floor(Number(tool.maxContextChars))) }
              : {}),
            ...(Number.isFinite(tool.requestTimeoutMs)
              ? { requestTimeoutMs: Math.max(1_000, Math.floor(Number(tool.requestTimeoutMs))) }
              : {}),
            ...(typeof tool.disableThinking === "boolean" ? { disableThinking: tool.disableThinking } : {})
          }
        }
      : {}),
    ...(chat
      ? { chat: { disableThinking: chat.disableThinking === true } }
      : {})
  };
}

/**
 * One-time data migration: seed the provider pool from legacy `llm` /
 * `chatLlm` / `embedding` settings and derive the per-use-case selections.
 * Replaces the old "three fixed models" model with the provider pool. No
 * runtime fallback is kept — after the pool exists the legacy fields are
 * ignored and eventually dropped from the settings file.
 */
export function migrateLegacyModelSettings(settings: PanelSettings): PanelSettings {
  const normalized = normalizeProviderPool(settings);
  if ((normalized.providers ?? []).length) {
    return {
      ...normalized,
      llmOptions: normalized.llmOptions ?? legacyLlmOptionsFrom(normalized)
    };
  }

  const legacyTool = normalized.llm;
  const legacyEmbedding = normalized.embedding;
  const toolModel = legacyTool.model?.trim();
  const toolBaseUrl = legacyTool.baseUrl?.trim();
  if (!toolModel || !toolBaseUrl) {
    return normalized;
  }

  const embModel = legacyEmbedding.model?.trim() || "text-embedding-3-small";
  const embBaseUrl = legacyEmbedding.baseUrl?.trim() || toolBaseUrl;
  const chatModel = normalized.chatLlm?.model?.trim() || toolModel;

  const toolProvider: AiProvider = {
    id: "provider-1",
    name: providerNameFromBaseUrl(toolBaseUrl),
    baseUrl: toolBaseUrl,
    apiKey: legacyTool.apiKey?.trim() || undefined,
    models: []
  };
  pushModel(toolProvider, toolModel, "text");
  if (chatModel !== toolModel) {
    pushModel(toolProvider, chatModel, "text");
  }

  const providers: AiProvider[] = [toolProvider];
  let embeddingProvider: AiProvider = toolProvider;
  if (normalizeBaseUrl(embBaseUrl) !== normalizeBaseUrl(toolBaseUrl)) {
    embeddingProvider = {
      id: "provider-2",
      name: `${providerNameFromBaseUrl(embBaseUrl)} (embedding)`,
      baseUrl: embBaseUrl,
      apiKey: legacyEmbedding.apiKey?.trim() || legacyTool.apiKey?.trim() || undefined,
      models: []
    };
    providers.push(embeddingProvider);
  }
  pushModel(embeddingProvider, embModel, "embedding");

  return {
    ...normalized,
    providers,
    modelSelections: {
      tool: { providerId: toolProvider.id, modelId: toolModel },
      chat: { providerId: toolProvider.id, modelId: chatModel },
      embedding: { providerId: embeddingProvider.id, modelId: embModel }
    },
    llmOptions: legacyLlmOptionsFrom(normalized)
  };
}