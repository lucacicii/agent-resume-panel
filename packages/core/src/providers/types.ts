import type { OutputLanguagePreference } from "../i18n/outputLanguage";

/**
 * Model capability kind. Providers expose a pool of models; consumers
 * (tool LLM, chat, embedding, image) enumerate the pool filtered by kind.
 */
export type ModelKind = "text" | "image" | "embedding";

export const MODEL_KINDS: readonly ModelKind[] = ["text", "image", "embedding"];

/** A model offered by a provider (fetched from `/models` or added manually). */
export interface ProviderModel {
  /** Model id passed to the API (e.g. `gpt-4o-mini`). */
  id: string;
  /** Primary capability kind. Editable in settings; default comes from id heuristics. */
  kind: ModelKind;
}

/** AI provider pool entry. */
export interface AiProvider {
  /** Stable id (uuid or slug) used by ModelSelection references. */
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  models: ProviderModel[];
}

/**
 * What the model is used for. Each use case picks one (providerId, modelId)
 * from the pool; the model must match the use case's ModelKind.
 */
export type ModelUse = "tool" | "chat" | "embedding" | "image";

export const MODEL_USES: readonly ModelUse[] = ["tool", "chat", "embedding", "image"];

export interface ModelSelection {
  providerId?: string;
  modelId?: string;
}

/** Per-use-case LLM options that are not provider properties. */
export interface LlmUseOptions {
  outputLanguage?: OutputLanguagePreference;
  maxContextChars?: number;
  requestTimeoutMs?: number;
  /** Send `thinking: { type: "disabled" }` (DeepSeek/Qwen/GLM). */
  disableThinking?: boolean;
}

export function isModelKind(value: unknown): value is ModelKind {
  return value === "text" || value === "image" || value === "embedding";
}

export function isModelUse(value: unknown): value is ModelUse {
  return value === "tool" || value === "chat" || value === "embedding" || value === "image";
}

export function normalizeProviderModel(value: unknown): ProviderModel | undefined {
  if (!value || typeof value !== "object") return undefined;
  const entry = value as { id?: unknown; kind?: unknown };
  const id = typeof entry.id === "string" ? entry.id.trim() : "";
  if (!id) return undefined;
  return {
    id,
    kind: isModelKind(entry.kind) ? entry.kind : "text"
  };
}

export function normalizeProvider(value: unknown): AiProvider | undefined {
  if (!value || typeof value !== "object") return undefined;
  const entry = value as { id?: unknown; name?: unknown; baseUrl?: unknown; apiKey?: unknown; models?: unknown };
  const id = typeof entry.id === "string" ? entry.id.trim() : "";
  const name = typeof entry.name === "string" ? entry.name.trim() : "";
  const baseUrl = typeof entry.baseUrl === "string" ? entry.baseUrl.trim() : "";
  if (!id || !name || !baseUrl) return undefined;
  const models: ProviderModel[] = [];
  if (Array.isArray(entry.models)) {
    for (const raw of entry.models) {
      const model = normalizeProviderModel(raw);
      if (model) models.push(model);
    }
  }
  return {
    id,
    name,
    baseUrl,
    apiKey: typeof entry.apiKey === "string" ? entry.apiKey : undefined,
    models
  };
}

export function normalizeSelection(value: unknown): ModelSelection | undefined {
  if (!value || typeof value !== "object") return undefined;
  const entry = value as { providerId?: unknown; modelId?: unknown };
  const providerId = typeof entry.providerId === "string" ? entry.providerId.trim() : "";
  const modelId = typeof entry.modelId === "string" ? entry.modelId.trim() : "";
  if (!providerId || !modelId) return undefined;
  return { providerId, modelId };
}

export function selectionIsEmpty(selection: ModelSelection | undefined | null): boolean {
  return !selection?.providerId || !selection?.modelId;
}