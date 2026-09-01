import { classifyModelKind } from "./classify";
import type { ProviderModel } from "./types";
import { normalizeBaseUrl } from "../llm/types";

const DEFAULT_MODELS_REQUEST_TIMEOUT_MS = 20_000;

export function buildModelsUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  if (normalized.endsWith("/models")) {
    return normalized;
  }
  return `${normalized}/models`;
}

interface ModelsListResponse {
  data?: Array<{ id?: unknown; object?: unknown }>;
  error?: { message?: unknown };
}

function dedupeModels(models: ProviderModel[]): ProviderModel[] {
  const seen = new Set<string>();
  const output: ProviderModel[] = [];
  for (const model of models) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    output.push(model);
  }
  return output;
}

/**
 * Fetch the model list of an OpenAI-compatible provider (`GET {base}/models`),
 * classify each entry by its id, and dedupe. Throws a readable error when the
 * endpoint is unreachable or the provider does not expose a model list.
 */
export async function fetchProviderModels(
  options: { baseUrl: string; apiKey?: string },
  timeoutMs = DEFAULT_MODELS_REQUEST_TIMEOUT_MS
): Promise<ProviderModel[]> {
  const url = buildModelsUrl(options.baseUrl || "");
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(options.apiKey?.trim() ? { Authorization: `Bearer ${options.apiKey.trim()}` } : {})
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error(`Model list request timed out after ${Math.round(timeoutMs / 1000)}s (endpoint: ${url}).`);
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new Error(`Could not reach ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }

  let payload: ModelsListResponse;
  try {
    payload = (await response.json()) as ModelsListResponse;
  } catch {
    throw new Error(`Model list request failed with status ${response.status}. (endpoint: ${url})`);
  }

  if (!response.ok) {
    const message =
      typeof payload.error?.message === "string"
        ? payload.error.message
        : `Model list request failed with status ${response.status}.`;
    throw new Error(`${message} (endpoint: ${url})`);
  }

  const ids: string[] = [];
  if (Array.isArray(payload.data)) {
    for (const entry of payload.data) {
      const id = typeof entry?.id === "string" ? entry.id.trim() : "";
      if (id) ids.push(id);
    }
  }

  if (!ids.length) {
    throw new Error(
      `The provider returned no models from ${url}. If the provider does not expose a model list, add models manually below.`
    );
  }

  return dedupeModels(
    ids.map((id) => ({
      id,
      kind: classifyModelKind(id)
    }))
  );
}