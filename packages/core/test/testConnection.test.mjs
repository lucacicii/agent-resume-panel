import assert from "node:assert/strict";
import test from "node:test";
import { testChatLlmConnection, testEmbeddingConnection } from "../dist/llm/testConnection.js";

const chatConfig = {
  baseUrl: "https://api.example.test/v1",
  model: "test-chat",
  apiKey: "sk-test"
};

const embConfig = {
  baseUrl: "https://api.example.test/v1",
  model: "text-embedding-test",
  apiKey: "sk-test"
};

test("testChatLlmConnection rejects incomplete config", async () => {
  await assert.rejects(() => testChatLlmConnection(undefined), /not configured/i);
  await assert.rejects(
    () => testChatLlmConnection({ baseUrl: "https://x", model: "m", apiKey: "" }),
    /not configured/i
  );
});

test("testEmbeddingConnection rejects incomplete config", async () => {
  await assert.rejects(() => testEmbeddingConnection(null), /not configured/i);
  await assert.rejects(
    () => testEmbeddingConnection({ baseUrl: "", model: "m", apiKey: "k" }),
    /not configured/i
  );
});

test("testChatLlmConnection returns endpoint summary on success", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /chat\/completions$/);
    const body = JSON.parse(String(init?.body || "{}"));
    assert.equal(body.model, "test-chat");
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "OK" } }],
        model: "test-chat"
      })
    };
  };
  try {
    const message = await testChatLlmConnection(chatConfig);
    assert.match(message, /Connected to https:\/\/api\.example\.test\/v1\/chat\/completions/);
    assert.match(message, /test-chat/);
    assert.match(message, /OK/);
  } finally {
    globalThis.fetch = original;
  }
});

test("testEmbeddingConnection returns vector dim on success", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /embeddings$/);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }],
        model: "text-embedding-test"
      })
    };
  };
  try {
    const message = await testEmbeddingConnection(embConfig);
    assert.match(message, /Connected to https:\/\/api\.example\.test\/v1\/embeddings/);
    assert.match(message, /vector dim 3/);
  } finally {
    globalThis.fetch = original;
  }
});
