import { chatCompletion } from "./chat";
import { embedTextsDetailed } from "./embeddings";
import {
  buildChatCompletionsUrl,
  buildEmbeddingsUrl,
  type EmbeddingRuntimeConfig,
  type LlmRuntimeConfig
} from "./types";

const NOT_CONFIGURED =
  "LLM is not configured. Set API base URL, model, and API key.";

const EMBEDDING_NOT_CONFIGURED =
  "Embedding is not configured. Set API base URL, model, and API key.";

function assertChatConfig(config: LlmRuntimeConfig | undefined | null): asserts config is LlmRuntimeConfig {
  if (!config?.baseUrl?.trim() || !config.model?.trim() || !config.apiKey?.trim()) {
    throw new Error(NOT_CONFIGURED);
  }
}

function assertEmbeddingConfig(
  config: EmbeddingRuntimeConfig | undefined | null
): asserts config is EmbeddingRuntimeConfig {
  if (!config?.baseUrl?.trim() || !config.model?.trim() || !config.apiKey?.trim()) {
    throw new Error(EMBEDDING_NOT_CONFIGURED);
  }
}

/** Lightweight chat/completions probe (Tool / Ask LLM). */
export async function testChatLlmConnection(config: LlmRuntimeConfig | undefined | null): Promise<string> {
  assertChatConfig(config);
  const endpoint = buildChatCompletionsUrl(config.baseUrl);
  const reply = await chatCompletion(
    config,
    [
      { role: "system", content: "Reply with exactly: OK" },
      { role: "user", content: "ping" }
    ],
    16
  );
  return `Connected to ${endpoint} (${config.model}): ${reply}`;
}

/** Lightweight embeddings probe. */
export async function testEmbeddingConnection(
  config: EmbeddingRuntimeConfig | undefined | null
): Promise<string> {
  assertEmbeddingConfig(config);
  const endpoint = buildEmbeddingsUrl(config.baseUrl);
  const result = await embedTextsDetailed(config, ["ping"]);
  const dim = result.vectors[0]?.length ?? 0;
  return `Connected to ${endpoint} (${config.model}): vector dim ${dim}`;
}
