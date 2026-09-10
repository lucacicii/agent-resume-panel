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
 *
 * Base uses:
 * - "tool": default Tool LLM (summarize, title suggest, git commit, reports, GTD)
 * - "chat": default conversational / Ask LLM (workbench chat, intent routing)
 * - "embedding": semantic search and vector indexing
 * - "image": image generation
 *
 * Specific override uses:
 * - "gitCommit": Git commit message generation
 * - "sessionRename": Session title suggest / auto rename
 * - "sessionSummary": Session summary generation
 * - "report": Daily / weekly / monthly digest generation
 * - "gtd": GTD task analysis from digest
 * - "imRouting": IM message smart intent routing
 * - "translate": inline transcript and IM message translation
 */
export type ModelUse =
  | "tool"
  | "chat"
  | "embedding"
  | "image"
  | "gitCommit"
  | "sessionRename"
  | "sessionSummary"
  | "report"
  | "gtd"
  | "imRouting"
  | "translate"
  | "sessionStatus";

export const MODEL_USES: readonly ModelUse[] = [
  "tool",
  "chat",
  "embedding",
  "image",
  "gitCommit",
  "sessionRename",
  "sessionSummary",
  "report",
  "gtd",
  "imRouting",
  "translate",
  "sessionStatus"
];

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

const MODEL_USE_SET = new Set<string>(MODEL_USES);

export function isModelUse(value: unknown): value is ModelUse {
  return typeof value === "string" && MODEL_USE_SET.has(value);
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