import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  createNoteMcpServer,
  ensureCatalogSchema,
  insertReportEntry,
  localDayRange,
  NotesStore
} from "../dist/index.js";

async function setupTestContext() {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-mcp-"));
  const dbPath = path.join(panelHome, "catalog.db");
  const store = new NotesStore(dbPath, panelHome);
  await store.initialize();
  return {
    panelHome,
    dbPath,
    store,
    ctx: { notesStore: store, dbPath, panelHome }
  };
}

async function seedDailyReportEntry(dbPath, panelHome, { label, title, content }) {
  await ensureCatalogSchema(dbPath);
  const period = localDayRange(label);
  const entry = {
    id: period.entryId,
    level: "daily",
    periodStartMs: period.startMs,
    periodEndMs: period.endMs,
    title,
    content,
    embeddingJson: null,
    createdAtMs: Date.now()
  };
  await insertReportEntry(dbPath, entry, []);
  return entry;
}

async function connectClient(server) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.1" });
  await client.connect(clientTransport);
  return client;
}

test("MCP server exposes all note and report tools", async () => {
  const { ctx } = await setupTestContext();
  const server = createNoteMcpServer(ctx);
  const client = await connectClient(server);

  try {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "note_append",
      "note_create",
      "note_delete",
      "note_read",
      "note_search",
      "note_write",
      "report_list",
      "report_read",
      "report_search"
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("note_create then note_search finds it", async () => {
  const { ctx } = await setupTestContext();
  const server = createNoteMcpServer(ctx);
  const client = await connectClient(server);

  try {
    const createResult = await client.callTool({
      name: "note_create",
      arguments: { scope: "library", title: "My Test Note", body: "Some content here." }
    });
    assert.ok(createResult.content[0].text.includes("Note created successfully"));

    const searchResult = await client.callTool({
      name: "note_search",
      arguments: { query: "Test Note" }
    });
    assert.ok(searchResult.content[0].text.includes("Found 1 note"));
    assert.ok(searchResult.content[0].text.includes("My Test Note"));
  } finally {
    await client.close();
    await server.close();
  }
});

test("note_search accepts large limit values without validation error", async () => {
  const { ctx } = await setupTestContext();
  const server = createNoteMcpServer(ctx);
  const client = await connectClient(server);

  try {
    const result = await client.callTool({
      name: "note_search",
      arguments: { query: "nonexistent", limit: 500 }
    });
    assert.notEqual(result.isError, true);
    assert.ok(result.content[0].text.includes("No notes found"));
  } finally {
    await client.close();
    await server.close();
  }
});

test("note_search matches notes by path segment", async () => {
  const { ctx, store } = await setupTestContext();
  const record = await store.createLibraryNote("# Tianji Note\n\nContent under tianji folder.");
  await store.writeNoteContent(record.noteId, "# Tianji Note\n\n天脊项目相关内容。");
  const server = createNoteMcpServer(ctx);
  const client = await connectClient(server);

  try {
    const result = await client.callTool({
      name: "note_search",
      arguments: { query: "天脊", limit: 50 }
    });
    assert.notEqual(result.isError, true);
    assert.ok(result.content[0].text.includes("Found"));
    assert.ok(result.content[0].text.includes(record.noteId));
  } finally {
    await client.close();
    await server.close();
  }
});

test("note_search returns empty message when no matches", async () => {
  const { ctx } = await setupTestContext();
  const server = createNoteMcpServer(ctx);
  const client = await connectClient(server);

  try {
    const result = await client.callTool({
      name: "note_search",
      arguments: { query: "nonexistent" }
    });
    assert.ok(result.content[0].text.includes("No notes found"));
  } finally {
    await client.close();
    await server.close();
  }
});

test("note_create with project scope requires projectPath", async () => {
  const { ctx } = await setupTestContext();
  const server = createNoteMcpServer(ctx);
  const client = await connectClient(server);

  try {
    const result = await client.callTool({
      name: "note_create",
      arguments: { scope: "project", title: "Missing Path" }
    });
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes("projectPath is required"));
  } finally {
    await client.close();
    await server.close();
  }
});

test("note_read returns full content of a note", async () => {
  const { ctx, store } = await setupTestContext();
  const record = await store.createLibraryNote("# Hello World\n\nBody text.");
  const server = createNoteMcpServer(ctx);
  const client = await connectClient(server);

  try {
    const result = await client.callTool({
      name: "note_read",
      arguments: { noteId: record.noteId }
    });
    const text = result.content[0].text;
    assert.ok(text.includes("Hello World"));
    assert.ok(text.includes("Body text."));
  } finally {
    await client.close();
    await server.close();
  }
});

test("note_read on nonexistent note returns error", async () => {
  const { ctx } = await setupTestContext();
  const server = createNoteMcpServer(ctx);
  const client = await connectClient(server);

  try {
    const result = await client.callTool({
      name: "note_read",
      arguments: { noteId: "nonexistent-id" }
    });
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes("Note not found"));
  } finally {
    await client.close();
    await server.close();
  }
});

test("note_write overwrites existing note content", async () => {
  const { ctx, store } = await setupTestContext();
  const record = await store.createLibraryNote("# Old Title\n\nOld content");
  const server = createNoteMcpServer(ctx);
  const client = await connectClient(server);

  try {
    await client.callTool({
      name: "note_write",
      arguments: { noteId: record.noteId, content: "# New Title\n\nNew content" }
    });

    const content = await store.readNoteContent(record.noteId);
    assert.ok(content.includes("New Title"));
    assert.ok(content.includes("New content"));
    assert.ok(!content.includes("Old content"));
  } finally {
    await client.close();
    await server.close();
  }
});

test("note_append adds content without modifying existing", async () => {
  const { ctx, store } = await setupTestContext();
  const record = await store.createLibraryNote("# Original\n\nFirst paragraph");
  const server = createNoteMcpServer(ctx);
  const client = await connectClient(server);

  try {
    await client.callTool({
      name: "note_append",
      arguments: { noteId: record.noteId, content: "Second paragraph" }
    });

    const content = await store.readNoteContent(record.noteId);
    assert.ok(content.includes("First paragraph"));
    assert.ok(content.includes("Second paragraph"));
  } finally {
    await client.close();
    await server.close();
  }
});

test("note_delete removes the note", async () => {
  const { ctx, store } = await setupTestContext();
  const record = await store.createLibraryNote("# To Delete\n\nContent");
  const server = createNoteMcpServer(ctx);
  const client = await connectClient(server);

  try {
    const result = await client.callTool({
      name: "note_delete",
      arguments: { noteId: record.noteId }
    });
    assert.ok(result.content[0].text.includes("Note deleted"));

    const after = await store.getNote(record.noteId);
    assert.equal(after, undefined);
  } finally {
    await client.close();
    await server.close();
  }
});

test("full CRUD lifecycle: create → read → append → write → delete", async () => {
  const { ctx } = await setupTestContext();
  const server = createNoteMcpServer(ctx);
  const client = await connectClient(server);

  try {
    // Create
    const createRes = await client.callTool({
      name: "note_create",
      arguments: { scope: "library", title: "Lifecycle Note", body: "v1" }
    });
    const jsonMatch = createRes.content[0].text.match(/"noteId":\s*"([^"]+)"/);
    const noteId = jsonMatch[1];
    assert.ok(noteId);

    // Read
    const readRes = await client.callTool({
      name: "note_read",
      arguments: { noteId }
    });
    assert.ok(readRes.content[0].text.includes("v1"));

    // Append
    await client.callTool({
      name: "note_append",
      arguments: { noteId, content: "v2 appended" }
    });
    const readAfterAppend = await client.callTool({
      name: "note_read",
      arguments: { noteId }
    });
    assert.ok(readAfterAppend.content[0].text.includes("v2 appended"));
    assert.ok(readAfterAppend.content[0].text.includes("v1"));

    // Write (overwrite)
    await client.callTool({
      name: "note_write",
      arguments: { noteId, content: "# Lifecycle Note\n\nv3 overwritten" }
    });
    const readAfterWrite = await client.callTool({
      name: "note_read",
      arguments: { noteId }
    });
    assert.ok(readAfterWrite.content[0].text.includes("v3 overwritten"));
    assert.ok(!readAfterWrite.content[0].text.includes("v1"));

    // Delete
    await client.callTool({
      name: "note_delete",
      arguments: { noteId }
    });
    const readAfterDelete = await client.callTool({
      name: "note_read",
      arguments: { noteId }
    });
    assert.equal(readAfterDelete.isError, true);
  } finally {
    await client.close();
    await server.close();
  }
});

test("report_list returns seeded daily digest", async () => {
  const { ctx, dbPath, panelHome } = await setupTestContext();
  const entry = await seedDailyReportEntry(dbPath, panelHome, {
    label: "2026-07-10",
    title: "Test Daily",
    content: "# Daily digest\n\nWorked on memory MCP."
  });
  const server = createNoteMcpServer(ctx);
  const client = await connectClient(server);

  try {
    const result = await client.callTool({
      name: "report_list",
      arguments: { level: "daily", limit: 10 }
    });
    assert.notEqual(result.isError, true);
    assert.ok(result.content[0].text.includes("Listed 1 daily"));
    assert.ok(result.content[0].text.includes(entry.id));
    assert.ok(result.content[0].text.includes("Test Daily"));
  } finally {
    await client.close();
    await server.close();
  }
});

test("report_read returns full digest content", async () => {
  const { ctx, dbPath, panelHome } = await setupTestContext();
  const entry = await seedDailyReportEntry(dbPath, panelHome, {
    label: "2026-07-11",
    title: "Read Test",
    content: "# Daily digest\n\nFull body for report_read."
  });
  const server = createNoteMcpServer(ctx);
  const client = await connectClient(server);

  try {
    const result = await client.callTool({
      name: "report_read",
      arguments: { reportId: entry.id }
    });
    assert.notEqual(result.isError, true);
    assert.ok(result.content[0].text.includes("Full body for report_read"));
    assert.ok(result.content[0].text.includes("Read Test"));
  } finally {
    await client.close();
    await server.close();
  }
});

test("report_search returns a structured response", async () => {
  const { ctx } = await setupTestContext();
  const server = createNoteMcpServer(ctx);
  const client = await connectClient(server);

  try {
    let result;
    try {
      result = await client.callTool({
        name: "report_search",
        arguments: { query: "nonexistent-memory-query-xyz" }
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      assert.match(msg, /Embedding is not configured/i);
      return;
    }
    const text = result.content?.[0]?.text || "";
    if (result.isError) {
      assert.match(text, /Embedding is not configured/i);
    } else {
      assert.ok(text.includes("No memory digests found"));
    }
  } finally {
    await client.close();
    await server.close();
  }
});
