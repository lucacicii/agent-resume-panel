import assert from "node:assert/strict";
import test from "node:test";
import { buildModelsUrl, fetchAvailableModels, isLocalLlmEndpoint } from "../../out/llm/models.js";

test("buildModelsUrl normalizes base URL variants", () => {
  assert.equal(buildModelsUrl("https://api.openai.com/v1"), "https://api.openai.com/v1/models");
  assert.equal(buildModelsUrl("https://api.openai.com/v1/"), "https://api.openai.com/v1/models");
  assert.equal(
    buildModelsUrl("https://api.deepseek.com/v1/chat/completions"),
    "https://api.deepseek.com/v1/models"
  );
  assert.equal(buildModelsUrl("http://localhost:11434/v1/models"), "http://localhost:11434/v1/models");
  assert.equal(isLocalLlmEndpoint("http://127.0.0.1:11434/v1"), true);
  assert.equal(isLocalLlmEndpoint("https://api.openai.com/v1"), false);
});

test("fetchAvailableModels parses OpenAI and Ollama payloads", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          data: [{ id: "gpt-4o-mini" }, { id: "gpt-4.1-mini" }, { id: "gpt-4o-mini" }]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );

    const openaiModels = await fetchAvailableModels({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test"
    });
    assert.deepEqual(openaiModels, ["gpt-4.1-mini", "gpt-4o-mini"]);

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          models: [{ name: "qwen2.5-coder:7b" }, { id: "llama3.2:latest" }]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );

    const ollamaModels = await fetchAvailableModels({
      baseUrl: "http://localhost:11434/v1"
    });
    assert.deepEqual(ollamaModels, ["llama3.2:latest", "qwen2.5-coder:7b"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
