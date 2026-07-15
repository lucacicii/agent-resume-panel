import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createNoteMcpServer, NotesStore, runToolLoop } from "../dist/index.js";

async function setupMcpPair() {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-loop-"));
  const dbPath = path.join(panelHome, "catalog.db");
  const store = new NotesStore(dbPath, panelHome);
  await store.initialize();

  const server = createNoteMcpServer({ notesStore: store, dbPath });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  return { store, server, clientTransport };
}

function createMockLlm() {
  let callCount = 0;
  const config = {
    baseUrl: "http://mock",
    model: "mock-model",
    apiKey: "mock-key",
    outputLanguage: "zh-CN"
  };

  // We monkey-patch global fetch to intercept LLM calls
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    if (!body.tools) {
      // Non-tool call — return plain content
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Plain response." }, finish_reason: "stop" }],
          model: "mock-model"
        })
      };
    }

    callCount++;
    if (callCount === 1) {
      // First call: request a tool call
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: null,
              tool_calls: [{
                id: "call_001",
                type: "function",
                function: {
                  name: "note_create",
                  arguments: JSON.stringify({ scope: "library", title: "Loop Test Note" })
                }
              }]
            },
            finish_reason: "tool_calls"
          }],
          model: "mock-model"
        })
      };
    }
    // Second call: return final response after tool result
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "笔记已创建成功！" }, finish_reason: "stop" }],
        model: "mock-model"
      })
    };
  };

  return { config, restore: () => { global.fetch = originalFetch; } };
}

test("runToolLoop executes tool calls and returns final answer", async () => {
  const { store, server, clientTransport } = await setupMcpPair();
  const mock = createMockLlm();

  const client = new Client({ name: "test", version: "0.0.1" });
  await client.connect(clientTransport);

  const mcpClient = {
    client,
    async start() {},
    async listTools() { return (await client.listTools()).tools; },
    async callTool(name, args) { return await client.callTool({ name, arguments: args }); },
    async stop() { await client.close(); }
  };

  try {
    const toolCallsSeen = [];
    const result = await runToolLoop({
      llm: mock.config,
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "帮我建一条笔记" }
      ],
      mcpClient,
      maxTokens: 1000,
      onToolCall: (name) => toolCallsSeen.push(name)
    });

    assert.equal(result.content, "笔记已创建成功！");
    assert.equal(result.toolCallsExecuted, 1);
    assert.deepEqual(toolCallsSeen, ["note_create"]);
    assert.equal(result.touchedNotes.length, 1);
    assert.equal(result.touchedNotes[0].operation, "create");
    assert.ok(result.touchedNotes[0].noteId);
    assert.ok(result.touchedNotes[0].title.includes("Loop Test Note"));

    // Verify the note was actually created in the store
    const allNotes = store.getAllNotes();
    assert.ok(allNotes.some((n) => (n.title || "").includes("Loop Test Note")));
  } finally {
    mock.restore();
    await server.close();
  }
});
