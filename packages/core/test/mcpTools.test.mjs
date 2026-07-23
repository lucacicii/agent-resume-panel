import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  createNoteMcpServer,
  desktopDbPath,
  ensureDesktopDbSchema,
  ensureExtensionCatalogSchema,
  insertReportEntry,
  localDayRange,
  NotesStore,
  runSqlite
} from "../dist/index.js";

async function setupTestContext() {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-mcp-"));
  const catalogDb = path.join(panelHome, "catalog.db");
  const desktopDb = desktopDbPath(panelHome);
  const store = new NotesStore(catalogDb, panelHome);
  await store.initialize();
  return {
    panelHome,
    catalogDb,
    desktopDb,
    dbPath: desktopDb,
    store,
    ctx: { notesStore: store, dbPath: desktopDb, panelHome, catalogDb }
  };
}

async function seedSession(catalogDb, {
  provider = "codex",
  id,
  title,
  projectPath = "/tmp/demo",
  summary = null,
  hidden = 0,
  updatedAtMs = Date.now()
}) {
  await ensureExtensionCatalogSchema(catalogDb);
  const summarySql = summary == null ? "NULL" : `'${String(summary).replaceAll("'", "''")}'`;
  await runSqlite(
    catalogDb,
    `INSERT INTO sessions (
       provider, agent_session_id, title, project_path, updated_at_ms, archived, hidden, session_summary
     ) VALUES (
       '${provider}', '${id}', '${String(title).replaceAll("'", "''")}',
       '${String(projectPath).replaceAll("'", "''")}', ${updatedAtMs}, 0, ${hidden}, ${summarySql}
     );`
  );
}

async function seedDailyReportEntry(desktopDb, panelHome, { label, title, content }) {
  await ensureDesktopDbSchema(desktopDb);
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
  await insertReportEntry(desktopDb, entry, []);
  return entry;
}

async function connectClient(server) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.1" });
  await client.connect(clientTransport);
  return client;
}

test("MCP server exposes all note, report, and session tools", async () => {
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
      "note_gtd_create",
      "note_gtd_delete",
      "note_gtd_list",
      "note_gtd_update",
      "note_list",
      "note_read",
      "note_search",
      "note_write",
      "report_list",
      "report_read",
      "report_search",
      "session_list",
      "session_read",
      "session_read_transcript",
      "session_resume",
      "session_search",
      "session_set_gtd"
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("note_list pages every note without requiring a search query", async () => {
  const { ctx } = await setupTestContext();
  await ctx.notesStore.createLibraryNote("# First\n\nOld note");
  await new Promise((resolve) => setTimeout(resolve, 2));
  await ctx.notesStore.createLibraryNote("# Second\n\nNew note");
  const server = createNoteMcpServer(ctx);
  const client = await connectClient(server);

  try {
    const first = await client.callTool({ name: "note_list", arguments: { limit: 1 } });
    assert.notEqual(first.isError, true);
    const firstPage = JSON.parse(first.content[0].text);
    assert.equal(firstPage.total, 2);
    assert.equal(firstPage.items.length, 1);
    assert.equal(firstPage.nextCursor, 1);

    const second = await client.callTool({
      name: "note_list",
      arguments: { limit: 1, cursor: firstPage.nextCursor }
    });
    const secondPage = JSON.parse(second.content[0].text);
    assert.equal(secondPage.items.length, 1);
    assert.equal(secondPage.nextCursor, undefined);
    assert.notEqual(firstPage.items[0].noteId, secondPage.items[0].noteId);
  } finally {
    await client.close();
    await server.close();
  }
});

test("MCP GTD tools manage :::gtd blocks without rewriting unrelated content", async () => {
  const { ctx } = await setupTestContext();
  const record = await ctx.notesStore.createLibraryNote("# Plan\n\nKeep this paragraph.\n");
  const server = createNoteMcpServer(ctx);
  const client = await connectClient(server);

  try {
    const created = await client.callTool({
      name: "note_gtd_create",
      arguments: { noteId: record.noteId, text: "Ship Notes GTD" }
    });
    assert.notEqual(created.isError, true);
    assert.ok(created.content[0].text.includes('"status": "next"'));

    const listed = await client.callTool({ name: "note_gtd_list", arguments: { query: "Ship Notes" } });
    assert.ok(listed.content[0].text.includes("Ship Notes GTD"));

    const updated = await client.callTool({
      name: "note_gtd_update",
      arguments: { noteId: record.noteId, taskText: "Ship Notes GTD", status: "done" }
    });
    assert.notEqual(updated.isError, true);

    const content = await ctx.notesStore.readNoteContent(record.noteId);
    assert.ok(content.includes("Keep this paragraph."));
    assert.ok(content.includes(":::gtd done\nShip Notes GTD\n:::"));

    const deleted = await client.callTool({
      name: "note_gtd_delete",
      arguments: { noteId: record.noteId, taskText: "Ship Notes GTD" }
    });
    assert.notEqual(deleted.isError, true);
    assert.ok(!(await ctx.notesStore.readNoteContent(record.noteId)).includes("Ship Notes GTD"));
  } finally {
    await client.close();
    await server.close();
  }
});

test("session_search finds catalog sessions by title and session_read returns summary", async () => {
  const { ctx, catalogDb } = await setupTestContext();
  await seedSession(catalogDb, {
    id: "sess-auth-1",
    title: "Auth OAuth refactor",
    summary: "Implemented OAuth login flow and token refresh."
  });
  await seedSession(catalogDb, {
    id: "sess-other",
    title: "Unrelated UI polish",
    summary: "Button spacing only."
  });
  await seedSession(catalogDb, {
    id: "sess-hidden",
    title: "Auth secret",
    summary: "hidden auth work",
    hidden: 1
  });

  const server = createNoteMcpServer(ctx);
  const client = await connectClient(server);

  try {
    const searchResult = await client.callTool({
      name: "session_search",
      arguments: { query: "OAuth" }
    });
    assert.notEqual(searchResult.isError, true);
    assert.ok(searchResult.content[0].text.includes("sess-auth-1"));
    assert.ok(searchResult.content[0].text.includes("Auth OAuth refactor"));
    assert.ok(!searchResult.content[0].text.includes("sess-hidden"));

    const listResult = await client.callTool({
      name: "session_list",
      arguments: { provider: "codex", limit: 10 }
    });
    assert.ok(listResult.content[0].text.includes("sess-auth-1"));

    const readResult = await client.callTool({
      name: "session_read",
      arguments: { provider: "codex", sessionId: "sess-auth-1" }
    });
    assert.ok(readResult.content[0].text.includes("OAuth login flow"));
    assert.ok(readResult.content[0].text.includes("sess-auth-1"));

    const chatTranscript = await client.callTool({
      name: "session_read_transcript",
      arguments: { provider: "chat", sessionId: "any" }
    });
    assert.ok(chatTranscript.content[0].text.toLowerCase().includes("unavailable"));

    const gtdOk = await client.callTool({
      name: "session_set_gtd",
      arguments: { provider: "codex", sessionId: "sess-auth-1", status: "next", reason: "test" }
    });
    assert.notEqual(gtdOk.isError, true);
    assert.ok(gtdOk.content[0].text.includes("GTD updated"));
    assert.ok(gtdOk.content[0].text.includes("\"status\": \"next\""));

    const gtdDone = await client.callTool({
      name: "session_set_gtd",
      arguments: { provider: "codex", sessionId: "sess-auth-1", status: "done" }
    });
    assert.equal(gtdDone.isError, true);

    const gtdMissing = await client.callTool({
      name: "session_set_gtd",
      arguments: { provider: "codex", sessionId: "does-not-exist", status: "inbox" }
    });
    assert.ok(
      gtdMissing.isError === true || gtdMissing.content[0].text.includes("No visible session")
    );

    const resumeMissing = await client.callTool({
      name: "session_resume",
      arguments: { provider: "codex", sessionId: "nope" }
    });
    assert.ok(resumeMissing.content[0].text.includes("No visible session"));
  } finally {
    await client.close();
    await server.close();
  }
});

test("session_resume invokes injected launcher with provider and id", async () => {
  const { ctx, catalogDb } = await setupTestContext();
  await seedSession(catalogDb, {
    id: "resume-me",
    title: "Resume target",
    summary: "work"
  });
  const launched = [];
  const server = createNoteMcpServer({
    ...ctx,
    resumeSession: async ({ provider, sessionId }) => {
      launched.push({ provider, sessionId });
      return { ok: true, command: `codex resume ${sessionId}`, cwd: "/tmp/demo", mode: "external-system", external: true };
    }
  });
  const client = await connectClient(server);
  try {
    const result = await client.callTool({
      name: "session_resume",
      arguments: { provider: "codex", sessionId: "resume-me" }
    });
    assert.notEqual(result.isError, true);
    assert.ok(result.content[0].text.includes("Resume launched"));
    assert.deepEqual(launched, [{ provider: "codex", sessionId: "resume-me" }]);
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
