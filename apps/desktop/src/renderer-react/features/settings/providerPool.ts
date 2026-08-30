import type { AiProvider, ModelKind, ModelSelection, ProviderModel } from "@agent-resume/core";

/**
 * Pure, browser-safe provider-pool helpers for the Settings renderer.
 * Keep in sync with packages/core `llm/fromSettings.ts` and
 * `providers/types.ts` (the renderer must not import core at runtime —
 * core bundles node-only modules that break the browser build).
 */

export interface PoolModelRef {
  providerId: string;
  providerName: string;
  modelId: string;
  kind: ModelKind;
}

export function isModelKind(value: unknown): value is ModelKind {
  return value === "text" || value === "image" || value === "embedding";
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

/** Enumerate every model of the given kind across the provider pool. */
export function listProviderModels(providers: AiProvider[], kind: ModelKind): PoolModelRef[] {
  const output: PoolModelRef[] = [];
  for (const provider of providers ?? []) {
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

/** Resolve one selection to its provider + model within the pool. Falls back to first valid model. */
export function resolveSelectedModel(
  providers: AiProvider[],
  selection: ModelSelection | undefined,
  kind: ModelKind = "text"
): { provider: AiProvider; model: ProviderModel } | undefined {
  if (selection?.providerId && selection?.modelId) {
    const provider = (providers ?? []).find((entry) => entry.id === selection.providerId);
    if (provider) {
      const model = (provider.models ?? []).find((entry) => entry.id === selection.modelId);
      if (model) return { provider, model };
    }
  }
  for (const provider of providers ?? []) {
    if (!provider.baseUrl?.trim()) continue;
    for (const model of provider.models ?? []) {
      if (model.kind === kind && model.id.trim()) {
        return { provider, model };
      }
    }
  }
  return undefined;
}