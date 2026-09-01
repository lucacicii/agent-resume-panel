import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  AGENT_TOOL_CATALOG,
  AGENT_TOOL_NAMES,
  createNoteMcpServer,
  desktopDbPath,
  ensureDesktopDbSchema,
  ensureExtensionCatalogSchema,
  ensureProjectForPath,
  handleLinkGraphTrace,
  insertReportEntry,
  localDayRange,
  NotesStore,
  runSqlite,
  toPortableKey
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

function parseToolJson(result) {
  const text = result.content?.[0]?.text || "";
  const start = text.search(/[\[{]/);
  return start >= 0 ? JSON.parse(text.slice(start)) : undefined;
}

test("MCP server exposes all note, report, session, and project tools", async () => {
  const { ctx } = await setupTestContext();
  const server = createNoteMcpServer(ctx);
  const client = await connectClient(server);

  try {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "entity_tag_add",
      "entity_tag_remove",
      "entity_tags_get",
      "link_graph_trace",
      "memory_retrieve",
      "note_append",
      "note_create",
      "note_delete",
      "note_list",
      "note_move",
      "note_read",
      "note_rename",
      "note_search",
      "note_set_gtd",
      "note_set_parent",
      "note_tree_read",
      "note_write",
      "project_list",
      "project_merge",
      "project_reconcile",
      "project_tidy",
      "report_list",
      "report_read",
      "report_search",
      "session_list",
      "session_move",
      "session_read",
      "session_read_transcript",
      "session_resume",
      "session_search",
      "session_set_gtd",
      "tag_entities_list",
      "tag_list",
      "tag_search"
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

test("MCP note_set_gtd stores note metadata without rewriting Markdown", async () => {
  const { ctx } = await setupTestContext();
  const record = await ctx.notesStore.createLibraryNote(
    "# Plan\n\n:::gtd next\nLegacy directive\n:::\n\nKeep this paragraph.\n"
  );
  const before = await ctx.notesStore.readNoteContent(record.noteId);
  const server = createNoteMcpServer(ctx);
  const client = await connectClient(server);

  try {
    const updated = await client.callTool({
      name: "note_set_gtd",
      arguments: { noteId: record.noteId, status: "waiting" }
    });
    assert.notEqual(updated.isError, true);
    const updatedNote = parseToolJson(updated);
    assert.equal(updatedNote.gtdStatus, "waiting");
    assert.equal(updatedNote.note.gtdStatus, "waiting");
    assert.equal(await ctx.notesStore.readNoteContent(record.noteId), before);

    const listed = await client.callTool({
      name: "note_list",
      arguments: { gtdStatus: "waiting" }
    });
    const page = parseToolJson(listed);
    assert.equal(page.total, 1);
    assert.equal(page.items[0].noteId, record.noteId);
    assert.equal(page.items[0].gtdStatus, "waiting");

    const cleared = await client.callTool({
      name: "note_set_gtd",
      arguments: { noteId: record.noteId, status: null }
    });
    assert.notEqual(cleared.isError, true);
    assert.equal(parseToolJson(cleared).gtdStatus, null);
    assert.equal((await ctx.notesStore.getNote(record.noteId)).gtdStatus, undefined);
    assert.equal(await ctx.notesStore.readNoteContent(record.noteId), before);
  } finally {
    await client.close();
    await server.close();
  }
});

test("session_search finds catalog sessions by title and session_read returns summary", async () => {
  const { ctx, catalogDb, panelHome } = await setupTestContext();
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
  // ACP (provider "chat") sessions are first-class: seed one with a real thread file so
  // session_read_transcript serves its transcript instead of reporting it unavailable.
  await seedSession(catalogDb, {
    provider: "chat",
    id: "chat-acp-1",
    title: "ACP chat",
    summary: "ACP chat summary."
  });
  await fs.mkdir(path.join(panelHome, "acp", "threads"), { recursive: true });
  await fs.writeFile(
    path.join(panelHome, "acp", "threads", "chat-acp-1.jsonl"),
    `${JSON.stringify({ id: "m1", role: "user", text: "hello from acp chat", timestamp: 1 })}\n`,
    "utf8"
  );

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
      arguments: { provider: "chat", sessionId: "chat-acp-1" }
    });
    assert.ok(chatTranscript.content[0].text.includes("Transcript excerpt"));
    assert.ok(chatTranscript.content[0].text.includes("hello from acp chat"));

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

test("note MCP creates and reads linked Project Note trees", async () => {
  const { ctx } = await setupTestContext();
  const server = createNoteMcpServer(ctx);
  const client = await connectClient(server);

  try {
    const rootResult = await client.callTool({
      name: "note_create",
      arguments: { scope: "project", projectPath: "/tmp/mcp-tree", title: "Root", body: "Root body" }
    });
    const root = parseToolJson(rootResult).note;
    const childResult = await client.callTool({
      name: "note_create",
      arguments: { parentNoteId: root.noteId, title: "Child", body: "Child body" }
    });
    const child = parseToolJson(childResult).note;
    assert.equal(child.owner.scope, "project");
    assert.equal(child.link.parentNoteId, root.noteId);

    const list = parseToolJson(await client.callTool({
      name: "note_list",
      arguments: { rootOnly: true, scope: "project" }
    }));
    assert.deepEqual(list.items.map((item) => item.noteId), [root.noteId]);

    const tree = parseToolJson(await client.callTool({
      name: "note_tree_read",
      arguments: { noteId: child.noteId }
    }));
    assert.equal(tree.rootNoteId, root.noteId);
    assert.equal(tree.currentNoteId, child.noteId);
    assert.equal(tree.tree.children[0].noteId, child.noteId);
    assert.equal(tree.nodeCount, 2);
  } finally {
    await client.close();
    await server.close();
  }
});

test("note MCP reparenting enforces Project Note tree invariants", async () => {
  const { ctx, store } = await setupTestContext();
  const a = await store.createProjectNote("/tmp/mcp-links", "# A");
  const b = await store.createProjectNote("/tmp/mcp-links", "# B");
  const library = await store.createLibraryNote("# Library");
  const server = createNoteMcpServer(ctx);
  const client = await connectClient(server);

  try {
    const linked = await client.callTool({
      name: "note_set_parent",
      arguments: { noteId: b.noteId, parentNoteId: a.noteId }
    });
    assert.equal(parseToolJson(linked).parentNoteId, a.noteId);

    const cycle = await client.callTool({
      name: "note_set_parent",
      arguments: { noteId: a.noteId, parentNoteId: b.noteId }
    });
    assert.equal(cycle.isError, true);
    assert.match(cycle.content[0].text, /cycle/i);

    const invalid = await client.callTool({
      name: "note_set_parent",
      arguments: { noteId: library.noteId, parentNoteId: a.noteId }
    });
    assert.equal(invalid.isError, true);
    assert.match(invalid.content[0].text, /project note/i);

    const detached = await client.callTool({
      name: "note_set_parent",
      arguments: { noteId: b.noteId, parentNoteId: null }
    });
    assert.equal(parseToolJson(detached).parentNoteId, null);
  } finally {
    await client.close();
    await server.close();
  }
});

test("note MCP preserves frontmatter through write/append and detaches on cross-scope move", async () => {
  const { ctx, store } = await setupTestContext();
  const root = await store.createProjectNote("/tmp/mcp-move", "# Root\n\nroot");
  const child = await store.createLinkedChildNote(root.noteId, "# Child\n\nold");
  const original = await store.readNoteContent(child.noteId);
  const idLine = original.match(/^id: .*$/m)?.[0];
  const server = createNoteMcpServer(ctx);
  const client = await connectClient(server);

  try {
    await client.callTool({ name: "note_write", arguments: { noteId: child.noteId, content: "# Updated\n\nnew body" } });
    await client.callTool({ name: "note_append", arguments: { noteId: child.noteId, content: "appended" } });
    const afterWrite = await store.readNoteContent(child.noteId);
    assert.ok(idLine && afterWrite.includes(idLine));
    assert.ok(afterWrite.includes("Updated"));
    assert.ok(afterWrite.includes("appended"));

    const moved = await client.callTool({
      name: "note_move",
      arguments: { noteId: child.noteId, scope: "library" }
    });
    assert.equal(parseToolJson(moved).detachedFromTree, true);
    const roots = parseToolJson(await client.callTool({
      name: "note_list",
      arguments: { rootOnly: true }
    }));
    assert.ok(roots.items.some((item) => item.noteId === child.noteId));

    const renamed = await client.callTool({
      name: "note_rename",
      arguments: { noteId: child.noteId, filename: "renamed-child.md" }
    });
    assert.equal(parseToolJson(renamed).note.filename, "renamed-child.md");
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

test("memory_retrieve returns unified context across memory sources", async () => {
  const { ctx, catalogDb, store } = await setupTestContext();
  await store.createLibraryNote("# Architecture\n\nNotes about microservices and auth.");
  await seedSession(catalogDb, { id: "sess-mem-1", title: "Refactor auth middleware", projectPath: "/tmp/auth" });
  const server = createNoteMcpServer(ctx);
  const client = await connectClient(server);

  try {
    const result = await client.callTool({
      name: "memory_retrieve",
      arguments: { query: "auth" }
    });
    assert.notEqual(result.isError, true);
    const data = parseToolJson(result);
    assert.ok(Array.isArray(data.notes));
    assert.ok(Array.isArray(data.sessions));
    assert.ok(Array.isArray(data.digests));
    assert.ok(Array.isArray(data.citations));
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

test("link_graph_trace fails fast when neither workspaceRoot nor a default is provided", async () => {
  const result = await handleLinkGraphTrace({ symbol: "deliveryNum" });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /workspaceRoot is required/);
});

test("link_graph_trace is hidden when enableLinkGraphTrace is false", async () => {
  const { ctx } = await setupTestContext();
  const server = createNoteMcpServer({ ...ctx, enableLinkGraphTrace: false });
  const client = await connectClient(server);
  try {
    const names = (await client.listTools()).tools.map((t) => t.name);
    assert.ok(!names.includes("link_graph_trace"));
  } finally {
    await client.close();
    await server.close();
  }
});

test("project_reconcile links same-path sessions and project_list reflects counts", async () => {
  const { ctx, catalogDb } = await setupTestContext();
  const projectPath = path.join(os.homedir(), "reconcile-mcp");
  await seedSession(catalogDb, { id: "rc-1", title: "One", projectPath });
  await seedSession(catalogDb, { id: "rc-2", title: "Two", projectPath });
  const server = createNoteMcpServer(ctx);
  const client = await connectClient(server);

  try {
    const reconcile = parseToolJson(await client.callTool({ name: "project_reconcile", arguments: {} }));
    assert.equal(reconcile.ok, true);
    assert.ok(reconcile.linkedSessions >= 1);

    const projects = parseToolJson(await client.callTool({ name: "project_list", arguments: {} }));
    const merged = projects.filter((p) => p.portableKey === toPortableKey(projectPath));
    assert.equal(merged.length, 1);
    assert.equal(merged[0].sessionCount, 2);
  } finally {
    await client.close();
    await server.close();
  }
});

test("project_merge reassigns sessions and removes the source project", async () => {
  const { ctx, catalogDb } = await setupTestContext();
  const pathA = path.join(os.homedir(), "merge-mcp-a");
  const pathB = path.join(os.homedir(), "merge-mcp-b");
  await seedSession(catalogDb, { id: "pm-a", title: "A", projectPath: pathA });
  await seedSession(catalogDb, { id: "pm-b", title: "B", projectPath: pathB });
  const server = createNoteMcpServer(ctx);
  const client = await connectClient(server);

  try {
    await client.callTool({ name: "project_reconcile", arguments: {} });
    let projects = parseToolJson(await client.callTool({ name: "project_list", arguments: {} }));
    const a = projects.find((p) => p.portableKey === toPortableKey(pathA));
    const b = projects.find((p) => p.portableKey === toPortableKey(pathB));
    assert.ok(a && b && a.projectId !== b.projectId);

    const merged = parseToolJson(await client.callTool({
      name: "project_merge",
      arguments: { sourceProjectId: a.projectId, targetProjectId: b.projectId }
    }));
    assert.equal(merged.ok, true);
    assert.equal(merged.targetProjectId, b.projectId);
    assert.ok(merged.mergedSessions >= 1);

    projects = parseToolJson(await client.callTool({ name: "project_list", arguments: {} }));
    assert.ok(!projects.some((p) => p.projectId === a.projectId));
  } finally {
    await client.close();
    await server.close();
  }
});

test("project_tidy reports candidates in dry run and hides them when applied", async () => {
  const { ctx, catalogDb } = await setupTestContext();
  const ghost = path.join(os.tmpdir(), `ghost-project-${Date.now()}`);
  await ensureProjectForPath(catalogDb, ghost); // directory does not exist → pathMissing
  const server = createNoteMcpServer(ctx);
  const client = await connectClient(server);

  try {
    const dry = parseToolJson(await client.callTool({ name: "project_tidy", arguments: {} }));
    assert.equal(dry.dryRun, true);
    assert.equal(dry.hiddenProjects, 0);
    assert.ok(dry.candidates.some((c) => c.portableKey === toPortableKey(ghost)));

    let projects = parseToolJson(await client.callTool({ name: "project_list", arguments: {} }));
    assert.ok(projects.some((p) => p.portableKey === toPortableKey(ghost)));

    const applied = parseToolJson(await client.callTool({ name: "project_tidy", arguments: { apply: true } }));
    assert.equal(applied.dryRun, false);
    assert.ok(applied.hiddenProjects >= 1);

    projects = parseToolJson(await client.callTool({ name: "project_list", arguments: {} }));
    assert.ok(!projects || !projects.some((p) => p.portableKey === toPortableKey(ghost)));
  } finally {
    await client.close();
    await server.close();
  }
});

test("AGENT_TOOL_CATALOG matches the tools registered by the MCP server", async () => {
  const { ctx } = await setupTestContext();
  const server = createNoteMcpServer(ctx); // default ctx keeps link_graph_trace registered
  const client = await connectClient(server);
  try {
    const registered = (await client.listTools()).tools.map((t) => t.name);
    const registeredSet = new Set(registered);
    const catalogNames = AGENT_TOOL_CATALOG.map((tool) => tool.name);

    // Every catalog entry is registered, and every registered tool is in the catalog.
    for (const name of catalogNames) {
      assert.ok(registeredSet.has(name), `catalog tool ${name} is not registered`);
    }
    for (const name of registered) {
      assert.ok(AGENT_TOOL_NAMES.has(name), `registered tool ${name} is missing from AGENT_TOOL_CATALOG`);
    }
    assert.equal(catalogNames.length, registered.length, "catalog and server tool counts differ");
  } finally {
    await client.close();
    await server.close();
  }
});

test("session_move reassigns a session to a different project directory", async () => {
  const { ctx, catalogDb } = await setupTestContext();
  const pathA = path.join(os.homedir(), "move-from");
  const pathB = path.join(os.homedir(), "move-to");
  await seedSession(catalogDb, { id: "mv-1", title: "Move me", projectPath: pathA });
  const server = createNoteMcpServer(ctx);
  const client = await connectClient(server);

  try {
    await client.callTool({ name: "project_reconcile", arguments: {} });

    const moved = parseToolJson(await client.callTool({
      name: "session_move",
      arguments: { provider: "codex", sessionId: "mv-1", targetProjectPath: pathB }
    }));
    assert.equal(moved.ok, true);
    assert.equal(moved.moved, true);
    assert.equal(path.resolve(moved.newPath), path.resolve(pathB));

    const read = parseToolJson(await client.callTool({
      name: "session_read",
      arguments: { provider: "codex", sessionId: "mv-1" }
    }));
    assert.equal(path.resolve(read.projectPath), path.resolve(pathB));

    const projects = parseToolJson(await client.callTool({ name: "project_list", arguments: {} }));
    const target = projects.find((p) => p.portableKey === toPortableKey(pathB));
    assert.ok(target && target.sessionCount === 1);
  } finally {
    await client.close();
    await server.close();
  }
});

test("session_move errors on unknown session and on missing target path", async () => {
  const { ctx } = await setupTestContext();
  const server = createNoteMcpServer(ctx);
  const client = await connectClient(server);

  try {
    const missing = await client.callTool({
      name: "session_move",
      arguments: { provider: "codex", sessionId: "does-not-exist", targetProjectPath: "/tmp/x" }
    });
    assert.equal(missing.isError, true);
    assert.match(missing.content[0].text, /not found/i);

    const noTarget = await client.callTool({
      name: "session_move",
      arguments: { provider: "codex", sessionId: "does-not-exist" }
    });
    assert.equal(noTarget.isError, true);
  } finally {
    await client.close();
    await server.close();
  }
});
