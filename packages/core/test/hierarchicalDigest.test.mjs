import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureDesktopDbSchema } from "../dist/index.js";
import { runHierarchicalDigest } from "../dist/report/hierarchicalDigest.js";

test("hierarchical digest chunks oversized sources without truncating their tails", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-hierarchical-"));
  const desktopDb = path.join(root, "desktop.db");
  await ensureDesktopDbSchema(desktopDb);
  const previousFetch = globalThis.fetch;
  let calls = 0;
  const requestUsers = [];
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    const body = JSON.parse(String(init.body));
    requestUsers.push(String(body.messages?.[1]?.content || ""));
    const isFinal = String(body.messages?.[0]?.content || "").includes("FINAL SYSTEM");
    return new Response(JSON.stringify({
      choices: [{ message: { content: isFinal ? "# Final digest" : `- compressed ${calls}` } }],
      model: "test-model",
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await runHierarchicalDigest({
      llm: { baseUrl: "https://example.test/v1", model: "test-model", apiKey: "test", maxContextChars: 4000 },
      desktopDb,
      source: "daily",
      jobKey: "daily:2026-07-27",
      level: "daily",
      periodLabel: "2026-07-27",
      outputLanguage: "English",
      sourceItems: [
        `Oversized source head ${"x".repeat(6000)} TAIL_SENTINEL_9f31`,
        ...Array.from({ length: 5 }, (_, index) => `Session ${index} ${"y".repeat(1300)}`)
      ],
      finalSystemPrompt: "FINAL SYSTEM",
      buildFinalUserPrompt: (items) => items.join("\n\n"),
      maxTokens: 1000
    });
    assert.equal(result.content, "# Final digest");
    assert.ok(result.chunkCount > 1);
    assert.ok(calls > result.chunkCount);
    assert.match(requestUsers.join("\n"), /TAIL_SENTINEL_9f31/);
  } finally {
    globalThis.fetch = previousFetch;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("hierarchical digest falls back to chunking after an endpoint context-length rejection", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-hierarchical-retry-"));
  const desktopDb = path.join(root, "desktop.db");
  await ensureDesktopDbSchema(desktopDb);
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ error: { message: "maximum context length exceeded" } }), {
        status: 400,
        headers: { "content-type": "application/json" }
      });
    }
    const body = JSON.parse(String(init.body));
    const isFinal = String(body.messages?.[0]?.content || "").includes("FINAL SYSTEM");
    return new Response(JSON.stringify({
      choices: [{ message: { content: isFinal ? "# Retried final" : "- compressed after retry" } }],
      model: "test-model"
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await runHierarchicalDigest({
      llm: { baseUrl: "https://example.test/v1", model: "test-model", apiKey: "test", maxContextChars: 120000 },
      desktopDb,
      source: "daily",
      jobKey: "daily:retry",
      level: "daily",
      periodLabel: "retry",
      outputLanguage: "English",
      sourceItems: ["one", "two"],
      finalSystemPrompt: "FINAL SYSTEM",
      buildFinalUserPrompt: (items) => items.join("\n"),
      maxTokens: 1000
    });
    assert.equal(result.content, "# Retried final");
    assert.ok(calls >= 3);
  } finally {
    globalThis.fetch = previousFetch;
    await fs.rm(root, { recursive: true, force: true });
  }
});
