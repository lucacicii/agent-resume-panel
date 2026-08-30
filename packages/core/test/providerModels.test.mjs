import assert from "node:assert/strict";
import test from "node:test";
import { classifyModelKind } from "../dist/providers/classify.js";
import { buildModelsUrl, fetchProviderModels } from "../dist/providers/fetch.js";
import {
  chatLlmConfigFromSettings,
  embeddingConfigFromSettings,
  listProviderModels,
  llmConfigFromSettings,
  resolveSelectedModel
} from "../dist/llm/fromSettings.js";
import { migrateLegacyModelSettings } from "../dist/providers/migrate.js";

test("classifyModelKind tags embedding / image / text models", () => {
  assert.equal(classifyModelKind("text-embedding-3-small"), "embedding");
  assert.equal(classifyModelKind("embed-v3"), "embedding");
  assert.equal(classifyModelKind("text-embedding-ada-002"), "embedding");
  assert.equal(classifyModelKind("dall-e-3"), "image");
  assert.equal(classifyModelKind("gpt-image-1"), "image");
  assert.equal(classifyModelKind("flux-schnell"), "image");
  assert.equal(classifyModelKind("gpt-4o-mini"), "text");
  assert.equal(classifyModelKind("deepseek-chat"), "text");
});

test("buildModelsUrl appends /models once", () => {
  assert.equal(buildModelsUrl("https://api.openai.com/v1"), "https://api.openai.com/v1/models");
  assert.equal(buildModelsUrl("http://localhost:11434/v1/"), "http://localhost:11434/v1/models");
  assert.equal(buildModelsUrl("https://x.test/v1/models"), "https://x.test/v1/models");
});

test("fetchProviderModels lists and classifies provider models", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.example.test/v1/models");
    assert.equal(init?.headers?.Authorization, "Bearer sk-test");
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { id: "gpt-4o-mini" },
          { id: "text-embedding-3-small" },
          { id: "dall-e-3" },
          { id: "gpt-4o-mini" }
        ]
      })
    };
  };
  try {
    const models = await fetchProviderModels({ baseUrl: "https://api.example.test/v1", apiKey: "sk-test" });
    assert.deepEqual(models, [
      { id: "gpt-4o-mini", kind: "text" },
      { id: "text-embedding-3-small", kind: "embedding" },
      { id: "dall-e-3", kind: "image" }
    ]);
  } finally {
    globalThis.fetch = original;
  }
});

test("fetchProviderModels throws with endpoint on failure and empty list", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    await assert.rejects(
      () => fetchProviderModels({ baseUrl: "https://x.test/v1" }),
      /status 404.*https:\/\/x\.test\/v1\/models/
    );
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) });
    await assert.rejects(
      () => fetchProviderModels({ baseUrl: "https://x.test/v1" }),
      /no models/
    );
  } finally {
    globalThis.fetch = original;
  }
});

const poolSettings = {
  uiLanguage: "en",
  llm: { baseUrl: "unused", model: "unused" },
  embedding: { model: "unused" },
  providers: [
    {
      id: "p1",
      name: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-1",
      models: [
        { id: "gpt-4o-mini", kind: "text" },
        { id: "gpt-4o", kind: "text" },
        { id: "dall-e-3", kind: "image" },
        { id: "text-embedding-3-small", kind: "embedding" }
      ]
    },
    {
      id: "p2",
      name: "Local",
      baseUrl: "http://localhost:11434/v1",
      apiKey: "local-key",
      models: [{ id: "llama3", kind: "text" }]
    }
  ],
  modelSelections: {
    tool: { providerId: "p1", modelId: "gpt-4o-mini" },
    chat: { providerId: "p2", modelId: "llama3" },
    embedding: { providerId: "p1", modelId: "text-embedding-3-small" }
  },
  llmOptions: {
    tool: { outputLanguage: "en", maxContextChars: 120000, requestTimeoutMs: 300000, disableThinking: false },
    chat: { disableThinking: true }
  }
};

test("listProviderModels enumerates the pool filtered by kind", () => {
  assert.deepEqual(
    listProviderModels(poolSettings, "text").map((entry) => `${entry.providerName}/${entry.modelId}`),
    ["OpenAI/gpt-4o-mini", "OpenAI/gpt-4o", "Local/llama3"]
  );
  assert.deepEqual(
    listProviderModels(poolSettings, "image").map((entry) => entry.modelId),
    ["dall-e-3"]
  );
  assert.deepEqual(
    listProviderModels(poolSettings, "embedding").map((entry) => entry.modelId),
    ["text-embedding-3-small"]
  );
});

test("llm/chat/embedding configs resolve from the provider pool", () => {
  const tool = llmConfigFromSettings(poolSettings);
  assert.equal(tool?.baseUrl, "https://api.openai.com/v1");
  assert.equal(tool?.model, "gpt-4o-mini");
  assert.equal(tool?.apiKey, "sk-1");
  assert.equal(tool?.outputLanguage, "English");
  assert.equal(tool?.maxContextChars, 120000);

  const chat = chatLlmConfigFromSettings(poolSettings);
  assert.equal(chat?.baseUrl, "http://localhost:11434/v1");
  assert.equal(chat?.model, "llama3");
  assert.equal(chat?.disableThinking, true);

  const embedding = embeddingConfigFromSettings(poolSettings);
  assert.equal(embedding?.baseUrl, "https://api.openai.com/v1");
  assert.equal(embedding?.model, "text-embedding-3-small");
  assert.equal(embedding?.apiKey, "sk-1");
});

test("chat config falls back to the tool selection when chat is unset", () => {
  const settings = {
    ...poolSettings,
    modelSelections: { tool: { providerId: "p1", modelId: "gpt-4o" } }
  };
  const chat = chatLlmConfigFromSettings(settings);
  assert.equal(chat?.model, "gpt-4o");
  // llmOptions.chat still applies when falling back to the tool selection.
  assert.equal(chat?.disableThinking, true);

  const noChatOptions = {
    ...settings,
    llmOptions: { tool: { outputLanguage: "auto" } }
  };
  assert.equal(chatLlmConfigFromSettings(noChatOptions)?.disableThinking, undefined);
});

test("unconfigured or dangling selections resolve to undefined", () => {
  assert.equal(llmConfigFromSettings({ ...poolSettings, modelSelections: {} }), undefined);
  assert.equal(
    llmConfigFromSettings({ ...poolSettings, modelSelections: { tool: { providerId: "missing", modelId: "x" } } }),
    undefined
  );
  assert.equal(resolveSelectedModel({ ...poolSettings, modelSelections: { image: { providerId: "x", modelId: "y" } } }, "image"), undefined);
});

test("migrateLegacyModelSettings seeds the pool from legacy llm/embedding", () => {
  const legacy = {
    uiLanguage: "zh-cn",
    llm: {
      baseUrl: "https://tool.example/v1",
      model: "deepseek-chat",
      apiKey: "legacy-key",
      outputLanguage: "Chinese",
      maxContextChars: 64000,
      disableThinking: true
    },
    embedding: { model: "text-embedding-3-small" }
  };
  const migrated = migrateLegacyModelSettings(legacy);
  assert.equal(migrated.providers.length, 1);
  assert.equal(migrated.providers[0].name, "tool.example");
  assert.equal(migrated.providers[0].apiKey, "legacy-key");
  assert.deepEqual(migrated.providers[0].models, [
    { id: "deepseek-chat", kind: "text" },
    { id: "text-embedding-3-small", kind: "embedding" }
  ]);
  assert.deepEqual(migrated.modelSelections?.embedding, {
    providerId: "provider-1",
    modelId: "text-embedding-3-small"
  });
  assert.equal(migrated.llmOptions?.tool?.outputLanguage, "zh-cn");
  assert.equal(migrated.llmOptions?.tool?.disableThinking, true);
});