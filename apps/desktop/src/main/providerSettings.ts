import {
  fetchProviderModels,
  testChatLlmConnection,
  testEmbeddingConnection,
  type ProviderModel
} from "@agent-resume/core";

/** Current form values of a provider (not necessarily saved). */
export interface ProviderDraft {
  id?: string;
  name?: string;
  baseUrl?: string;
  apiKey?: string;
}

/** A provider "test connection" probes one capability kind with a concrete model. */
export type ProviderTestKind = "text" | "embedding";

export interface ProviderTestConnectionArgs {
  kind?: unknown;
  provider?: ProviderDraft | null;
  modelId?: unknown;
}

export interface ProviderTestConnectionResult {
  ok: boolean;
  message: string;
}

export interface ProviderFetchModelsResult {
  ok: boolean;
  models?: ProviderModel[];
  message?: string;
}

export function parseProviderTestKind(value: unknown): ProviderTestKind {
  if (value === "text" || value === "embedding") {
    return value;
  }
  throw new Error(`Unsupported provider test kind: ${String(value)}`);
}

function draftProviderValues(
  provider: ProviderDraft | undefined | null,
  modelId: unknown
): { baseUrl: string; apiKey: string; modelId: string } {
  const baseUrl = typeof provider?.baseUrl === "string" ? provider.baseUrl.trim() : "";
  const apiKey = typeof provider?.apiKey === "string" ? provider.apiKey.trim() : "";
  const model = typeof modelId === "string" ? modelId.trim() : "";
  return { baseUrl, apiKey, modelId: model };
}

/** Probe a provider using unsaved form values (draft provider + one model id). */
export async function testProviderConnectionFromDraft(
  args: ProviderTestConnectionArgs
): Promise<ProviderTestConnectionResult> {
  const kind = parseProviderTestKind(args.kind);
  const { baseUrl, apiKey, modelId } = draftProviderValues(args.provider, args.modelId);
  try {
    if (kind === "embedding") {
      if (!baseUrl || !apiKey || !modelId) {
        throw new Error("Embedding is not configured. Set provider base URL, API key, and an embedding model.");
      }
      const message = await testEmbeddingConnection({ baseUrl, model: modelId, apiKey });
      return { ok: true, message };
    }
    if (!baseUrl || !apiKey || !modelId) {
      throw new Error("LLM is not configured. Set provider base URL, API key, and a text model.");
    }
    const message = await testChatLlmConnection({ baseUrl, model: modelId, apiKey });
    return { ok: true, message };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

/** Fetch the model list of a provider using unsaved form values. */
export async function fetchProviderModelsFromDraft(args: {
  baseUrl?: unknown;
  apiKey?: unknown;
}): Promise<ProviderFetchModelsResult> {
  const baseUrl = typeof args?.baseUrl === "string" ? args.baseUrl.trim() : "";
  const apiKey = typeof args?.apiKey === "string" ? args.apiKey.trim() : undefined;
  try {
    const models = await fetchProviderModels({ baseUrl, apiKey });
    return { ok: true, models };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}