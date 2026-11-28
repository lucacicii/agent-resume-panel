import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  catalogDbPath,
  ensureExtensionCatalogSchema,
  newNoteId,
  noteRelMdPath,
  runSqlite,
  searchIndexDbPath,
  setNoteGtdStatus,
  setSessionGtdStatus,
  upsertNoteRecord,
  writeNewNoteFile
} from "@agent-resume/core";
import { createAgentResumeMcpServer } from "../dist/index.js";

function parseToolJson(result) {
  assert.equal(result.isError, undefined);
  assert.ok(Array.isArray(result.content) && result.content.length > 0);
  return JSON.parse(result.content[0].text);
}

test("MCP server queries notes, sessions, projects, and unified search", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-mcp-test-"));
  const panelHome = path.join(tmpRoot, "panel-home");
  const dbPath = catalogDbPath(panelHome);
  const idxPath = searchIndexDbPath(panelHome);

  try {
    await ensureExtensionCatalogSchema(dbPath);

    const projectDir = path.join(tmpRoot, "demo-project");
    const transcriptFile = path.join(tmpRoot, "codex-session.jsonl");
    await fs.writeFile(
      transcriptFile,
      [
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "How do we expose notes via MCP?" }]
          }
        }),
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Build a standalone stdio CLI package in packages/mcp." }]
          }
        })
      ].join("\n"),
      "utf8"
    );

    const refsJson = JSON.stringify({ kind: "jsonl", paths: [transcriptFile] }).replaceAll("'", "''");
    await runSqlite(
      dbPath,
      `INSERT INTO sessions (
         provider, agent_session_id, title, project_path, updated_at_ms,
         archived, message_count, model, branch, source, hidden,
         transcript_kind, transcript_refs, session_summary, native_project_path
       ) VALUES (
         'codex', 'sess-123', 'MCP Architecture Discussion', '${projectDir.replaceAll("'", "''")}', 1700000000000,
         0, 2, 'gpt-5', 'main', 'cli', 0,
         'jsonl', '${refsJson}', 'Discussed standalone MCP CLI package.', '${projectDir.replaceAll("'", "''")}'
       );`
    );
    await setSessionGtdStatus(dbPath, "codex", "sess-123", "next");

    const noteId = newNoteId();
    const owner = { scope: "session", provider: "codex", sessionId: "sess-123", projectPath: projectDir };
    const filename = "2026-11-28-mcp-plan.md";
    const created = await writeNewNoteFile({
      panelHome,
      owner,
      filename,
      noteId,
      body: "# MCP Implementation Notes\n\nExpose list_notes and list_sessions tools."
    });
    await upsertNoteRecord(dbPath, {
      noteId,
      scope: "session",
      provider: "codex",
      agentSessionId: "sess-123",
      projectPath: projectDir,
      filename,
      relDir: path.dirname(noteRelMdPath(owner, filename)),
      relMdPath: noteRelMdPath(owner, filename),
      title: "MCP Implementation Notes",
      contentPreview: "Expose list_notes and list_sessions tools.",
      createdAtMs: 1700000001000,
      updatedAtMs: 1700000002000
    });
    await setNoteGtdStatus(dbPath, noteId, "inbox");

    const server = createAgentResumeMcpServer({
      panelHome,
      catalogDbPath: dbPath,
      searchIndexDbPath: idxPath,
      antigravityHome: path.join(tmpRoot, "agy"),
      opencodeHome: path.join(tmpRoot, "opencode")
    });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      const listedTools = await client.listTools();
      const toolNames = listedTools.tools.map((t) => t.name).sort();
      assert.deepEqual(toolNames, [
        "get_session",
        "list_notes",
        "list_projects",
        "list_sessions",
        "read_note",
        "search_agent_resume"
      ]);

      const notesRes = parseToolJson(
        await client.callTool({ name: "list_notes", arguments: { scope: "all", gtdStatus: "inbox" } })
      );
      assert.equal(notesRes.total, 1);
      assert.equal(notesRes.notes[0].noteId, noteId);
      assert.equal(notesRes.notes[0].absPath, created.absPath);

      const noteReadRes = parseToolJson(
        await client.callTool({ name: "read_note", arguments: { noteId } })
      );
      assert.match(noteReadRes.body, /Expose list_notes and list_sessions tools/);

      const sessionsRes = parseToolJson(
        await client.callTool({
          name: "list_sessions",
          arguments: { provider: "codex", gtdStatus: "next", search: "Architecture" }
        })
      );
      assert.equal(sessionsRes.total, 1);
      assert.equal(sessionsRes.sessions[0].id, "sess-123");
      assert.equal(sessionsRes.sessions[0].gtdStatus, "next");

      const sessionDetailRes = parseToolJson(
        await client.callTool({
          name: "get_session",
          arguments: { provider: "codex", sessionId: "sess-123" }
        })
      );
      assert.equal(sessionDetailRes.linkedNotes.length, 1);
      assert.match(sessionDetailRes.transcript, /standalone stdio CLI package/);

      const searchRes = parseToolJson(
        await client.callTool({
          name: "search_agent_resume",
          arguments: { query: "standalone stdio" }
        })
      );
      assert.equal(searchRes.sessions.total, 1);
      assert.equal(searchRes.sessions.items[0].id, "sess-123");
    } finally {
      await Promise.all([client.close(), server.close()]);
    }

    // Verify standalone single-file CJS bundle works outside workspace node_modules over stdio
    const standalonePath = path.join(tmpRoot, "standalone-mcp.cjs");
    await fs.copyFile(path.join(import.meta.dirname, "..", "dist", "agent-resume-mcp.cjs"), standalonePath);
    const stdioClient = new Client({ name: "stdio-test-client", version: "1.0.0" });
    const stdioTransport = new StdioClientTransport({
      command: process.execPath,
      args: [standalonePath, "--panel-home", panelHome],
      stderr: "pipe"
    });
    await stdioClient.connect(stdioTransport);
    try {
      const stdioTools = await stdioClient.listTools();
      assert.equal(stdioTools.tools.length, 6);
      const stdioNotes = parseToolJson(
        await stdioClient.callTool({ name: "list_notes", arguments: { scope: "all" } })
      );
      assert.equal(stdioNotes.total, 1);
      assert.equal(stdioNotes.notes[0].noteId, noteId);
    } finally {
      await stdioClient.close();
    }
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});
