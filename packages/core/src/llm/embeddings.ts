import { buildEmbeddingsUrl, EmbeddingRuntimeConfig } from "./types";

interface EmbeddingsResponse {
  data?: Array<{
    embedding?: number[];
    index?: number;
  }>;
  error?: {
    message?: string;
  };
}

export async function embedTexts(config: EmbeddingRuntimeConfig, texts: string[]): Promise<number[][]> {
  if (!texts.length) {
    return [];
  }

  const url = buildEmbeddingsUrl(config.baseUrl);
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

  if (!response.ok) {
    const message = payload.error?.message || `Embedding request failed with status ${response.status}.`;
    throw new Error(`${message} (endpoint: ${url})`);
  }

  const data = payload.data || [];
  const sorted = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return sorted.map((item) => {
    if (!item.embedding?.length) {
      throw new Error("Embedding API returned an empty vector.");
    }
    return item.embedding;
  });
}
