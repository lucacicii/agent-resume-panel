import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import {
  ensureExtensionCatalogSchema,
  queryUnifiedSearch,
  runSqliteTransaction,
  searchIndexDbPath,
  syncSearchIndex
} from "../dist/index.js";

test("unified search indexes sessions, ACP, and notes incrementally and supports full-text + fuzzy search", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-unified-search-"));
  const catalogDb = path.join(panelHome, "catalog.db");
  const indexDb = searchIndexDbPath(panelHome);
  const agyHome = path.join(panelHome, "agy");

  try {
    await ensureExtensionCatalogSchema(catalogDb);

    // 1. Create sample transcripts on disk: Claude, Pi, ACP, Agy brain log, and Notes
    const projectA = "/tmp/proj-alpha";
    const projectB = "/tmp/proj-beta";

    const claudeFile = path.join(panelHome, "claude-s1.jsonl");
    await fs.writeFile(
      claudeFile,
      [
        JSON.stringify({
          type: "user",
          message: { role: "user", content: "Please optimize database query latency for search" }
        }),
        JSON.stringify({
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "We can add an FTS5 trigram index for 模糊匹配所有内容." },
              { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/ignored/noise" } },
              { type: "tool_result", tool_use_id: "t1", content: "TOOL_NOISE_SHOULD_NOT_INDEX" }
            ]
          }
        })
      ].join("\n"),
      "utf8"
    );

    const acpFile = path.join(panelHome, "acp", "threads", "acp-1.jsonl");
    await fs.mkdir(path.dirname(acpFile), { recursive: true });
    await fs.writeFile(
      acpFile,
      [
        JSON.stringify({ id: "m1", role: "user", text: "Discuss ACP parallel column architecture" }),
        JSON.stringify({ id: "m2", role: "assistant", text: "Three columns: Sessions, ACP, and Notes." })
      ].join("\n"),
      "utf8"
    );

    const agyLogsDir = path.join(agyHome, "brain", "agy-1", ".system_generated", "logs");
    await fs.mkdir(agyLogsDir, { recursive: true });
    await fs.writeFile(
      path.join(agyLogsDir, "transcript_full.jsonl"),
      [
        JSON.stringify({
          type: "USER_INPUT",
          step_index: 1,
          content: "<USER_REQUEST>Investigate antigravity brain logs</USER_REQUEST><ADDITIONAL_METADATA>ignored</ADDITIONAL_METADATA>"
        }),
        JSON.stringify({
          type: "PLANNER_RESPONSE",
          step_index: 2,
          content: "Found full transcript inside brain logs with secret-agy-token."
        })
      ].join("\n"),
      "utf8"
    );

    const noteRelPath = "notes/projects/proj-alpha/2026-11-28-design.md";
    const noteAbsPath = path.join(panelHome, noteRelPath);
    await fs.mkdir(path.dirname(noteAbsPath), { recursive: true });
    await fs.writeFile(
      noteAbsPath,
      [
        "---",
        "id: note-1",
        "scope: project",
        `projectPath: ${projectA}`,
        "---",
        "",
        "# Search Architecture Note",
        "",
        "支持关键字下拉筛选以及 AI 搜索工作流。"
      ].join("\n"),
      "utf8"
    );

    const almaDbPath = path.join(panelHome, "alma", "chat_threads.db");
    await fs.mkdir(path.dirname(almaDbPath), { recursive: true });
    execFileSync("sqlite3", [
      almaDbPath,
      `CREATE TABLE chat_messages (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, message TEXT NOT NULL, timestamp TEXT NOT NULL, created_at TEXT NOT NULL);
       INSERT INTO chat_messages VALUES ('am-1', 'alma-1', '${JSON.stringify({
         role: "user",
         parts: [{ type: "text", text: "Investigate alma-fts5-marker in Alma SQLite" }]
       }).replaceAll("'", "''")}', '2026-11-28T00:00:01Z', '2026-11-28T00:00:01Z');`
    ]);

    const now = Date.now();
    await runSqliteTransaction(catalogDb, [
      `INSERT INTO sessions (provider, agent_session_id, title, project_path, updated_at_ms, hidden, transcript_kind, transcript_refs, session_summary)
       VALUES ('claude', 's1', 'Query Tuning', '${projectA}', ${now}, 0, 'jsonl', '${JSON.stringify({ kind: "jsonl", paths: [claudeFile] })}', 'Database speed up')`,
      `INSERT INTO sessions (provider, agent_session_id, title, project_path, updated_at_ms, hidden, transcript_kind, transcript_refs)
       VALUES ('agy', 'agy-1', 'Agy Investigation', '${projectB}', ${now - 1000}, 0, 'unavailable', '{}')`,
      `INSERT INTO sessions (provider, agent_session_id, title, project_path, updated_at_ms, hidden, transcript_kind, transcript_refs)
       VALUES ('alma', 'alma-1', 'Alma SQLite Thread', '${projectB}', ${now - 1500}, 0, 'sqlite', '${JSON.stringify({ kind: "sqlite", dbPath: almaDbPath, dialect: "alma", sessionId: "alma-1" })}')`,
      `INSERT INTO sessions (provider, agent_session_id, title, project_path, updated_at_ms, hidden, acp_provider, transcript_kind, transcript_refs)
       VALUES ('chat', 'acp-1', 'ACP UI Layout', '${projectA}', ${now - 2000}, 0, 'claude', 'acp', '${JSON.stringify({ kind: "acp", threadPath: acpFile, sessionsIndexPath: path.join(panelHome, "acp", "sessions.jsonl") })}')`,
      `INSERT INTO session_gtd (provider, agent_session_id, status, updated_at_ms)
       VALUES ('claude', 's1', 'doing', ${now})`,
      `INSERT INTO notes (note_id, scope, project_path, filename, rel_dir, rel_md_path, title, content_preview, created_at_ms, updated_at_ms)
       VALUES ('note-1', 'project', '${projectA}', '2026-11-28-design.md', 'notes/projects/proj-alpha', '${noteRelPath}', 'Search Architecture Note', '支持关键字下拉筛选', ${now}, ${now})`
    ]);

    // 2. First sync
    const sync1 = await syncSearchIndex({
      catalogDbPath: catalogDb,
      indexDbPath: indexDb,
      panelHome,
      antigravityHome: agyHome
    });
    assert.equal(sync1.indexedSessions, 3);
    assert.equal(sync1.indexedAcp, 1);
    assert.equal(sync1.indexedNotes, 1);
    assert.equal(sync1.updatedDocs, 5);

    // 3. Second sync with no changes should skip all 5 docs
    const sync2 = await syncSearchIndex({
      catalogDbPath: catalogDb,
      indexDbPath: indexDb,
      panelHome,
      antigravityHome: agyHome
    });
    assert.equal(sync2.updatedDocs, 0);
    assert.equal(sync2.skippedDocs, 5);

    // 4. FTS5 trigram body search (Chinese >= 3 chars)
    const cnRes = await queryUnifiedSearch({
      indexDbPath: indexDb,
      query: "模糊匹配"
    });
    assert.equal(cnRes.sessions.total, 1);
    assert.equal(cnRes.sessions.items[0].id, "s1");
    assert.equal(cnRes.sessions.items[0].matchSource, "body");
    assert.ok(cnRes.sessions.items[0].snippet?.includes("模糊匹配"));

    // 5. Tool result noise must NOT be indexed
    const noiseRes = await queryUnifiedSearch({
      indexDbPath: indexDb,
      query: "TOOL_NOISE_SHOULD_NOT_INDEX"
    });
    assert.equal(noiseRes.sessions.total, 0);

    // 6. Short 2-char query fallback (< 3 chars) across sessions and notes
    const shortRes = await queryUnifiedSearch({
      indexDbPath: indexDb,
      query: "AI"
    });
    assert.equal(shortRes.notes.total, 1);
    assert.equal(shortRes.notes.items[0].id, "note-1");

    // 7. Agy brain log & Alma SQLite extraction worked
    const agyRes = await queryUnifiedSearch({
      indexDbPath: indexDb,
      query: "secret-agy-token"
    });
    assert.equal(agyRes.sessions.total, 1);
    assert.equal(agyRes.sessions.items[0].id, "agy-1");

    const almaRes = await queryUnifiedSearch({
      indexDbPath: indexDb,
      query: "alma-fts5-marker"
    });
    assert.equal(almaRes.sessions.total, 1);
    assert.equal(almaRes.sessions.items[0].id, "alma-1");

    // 8. Fuzzy subsequence match on title
    const fuzzyRes = await queryUnifiedSearch({
      indexDbPath: indexDb,
      query: "qrytng"
    });
    assert.equal(fuzzyRes.sessions.total, 1);
    assert.equal(fuzzyRes.sessions.items[0].id, "s1");
    assert.equal(fuzzyRes.sessions.items[0].matchSource, "fuzzy");

    // 9. Project filter isolates projectB vs projectA across all 3 columns
    const projARes = await queryUnifiedSearch({
      indexDbPath: indexDb,
      projectScope: { projectPath: projectA }
    });
    assert.equal(projARes.sessions.total, 1);
    assert.equal(projARes.acp.total, 1);
    assert.equal(projARes.notes.total, 1);

    // 10. GTD filter
    const gtdRes = await queryUnifiedSearch({
      indexDbPath: indexDb,
      gtdFilter: "doing"
    });
    assert.equal(gtdRes.sessions.total, 1);
    assert.equal(gtdRes.acp.total, 0);
    assert.equal(gtdRes.notes.total, 0);

    // 11. Hiding a session removes it on next sync
    await runSqliteTransaction(catalogDb, [
      `UPDATE sessions SET hidden = 1 WHERE provider = 'agy' AND agent_session_id = 'agy-1'`
    ]);
    const sync3 = await syncSearchIndex({
      catalogDbPath: catalogDb,
      indexDbPath: indexDb,
      panelHome,
      antigravityHome: agyHome
    });
    assert.equal(sync3.deletedDocs, 1);
    const agyAfterHide = await queryUnifiedSearch({
      indexDbPath: indexDb,
      query: "secret-agy-token"
    });
    assert.equal(agyAfterHide.sessions.total, 0);
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});
