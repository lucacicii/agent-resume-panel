import { buildEmbeddingsUrl, EmbeddingRuntimeConfig } from "./types";
import { parseOpenAiUsage, TokenUsage } from "../usage/types";

interface EmbeddingsResponse {
  data?: Array<{
    embedding?: number[];
    index?: number;
  }>;
  model?: string;
  usage?: unknown;
  error?: {
    message?: string;
  };
}

export interface EmbedCallResult {
  vectors: number[][];
  usage?: TokenUsage;
  model?: string;
  durationMs: number;
}

export async function embedTextsDetailed(
  config: EmbeddingRuntimeConfig,
  texts: string[]
): Promise<EmbedCallResult> {
  if (!texts.length) {
    return { vectors: [], durationMs: 0 };
  }

  const url = buildEmbeddingsUrl(config.baseUrl);
  const started = Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      input: texts
    }),
    signal: AbortSignal.timeout(120_000)
  });

  let payload: EmbeddingsResponse;
  try {
    payload = (await response.json()) as EmbeddingsResponse;
  } catch {
    throw new Error(`Embedding request failed with status ${response.status}.`);
  }

  const durationMs = Date.now() - started;

  if (!response.ok) {
    const message = payload.error?.message || `Embedding request failed with status ${response.status}.`;
    throw new Error(`${message} (endpoint: ${url})`);
  }

  const data = payload.data || [];
  const sorted = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const vectors = sorted.map((item) => {
    if (!item.embedding?.length) {
      throw new Error("Embedding API returned an empty vector.");
    }
    return item.embedding;
  });

  return {
    vectors,
    usage: parseOpenAiUsage(payload.usage),
    model: payload.model || config.model,
    durationMs
  };
}

export async function embedTexts(config: EmbeddingRuntimeConfig, texts: string[]): Promise<number[][]> {
  const result = await embedTextsDetailed(config, texts);
  return result.vectors;
}
