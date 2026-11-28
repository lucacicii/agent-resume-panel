#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);

const { renameSession } = require("../out/history/rename/index.js");
const {
  catalogDbPath,
  DEFAULT_AGENT_HOMES,
  defaultAlmaHome,
  defaultCursorIdeUserDataHome,
  ensureExtensionCatalogSchema,
  insertAcpSessionRecord,
  loadAcpSessionRecords,
  runSqliteJson,
  setUserTitleIfUnsetInCatalog,
  syncAgentSessions,
  upsertAcpSessionInCatalog
} = require("../../../packages/core/dist/index.js");

function sqlite(dbPath, sql) {
  execFileSync("sqlite3", [dbPath, sql]);
}

async function jsonl(file, rows) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function buildSyncOptions(panelHome, homes) {
  return {
    dbPath: catalogDbPath(panelHome),
    panelHome,
    codexHome: homes.codexHome,
    claudeHome: homes.claudeHome,
    antigravityHome: homes.antigravityHome,
    grokHome: homes.grokHome,
    opencodeHome: homes.opencodeHome,
    piHome: homes.piHome,
    primeHome: homes.primeHome,
    ompHome: homes.ompHome,
    cursorHome: homes.cursorHome || DEFAULT_AGENT_HOMES.cursorHome,
    cursorIdeUserDataHome: homes.cursorIdeUserDataHome || defaultCursorIdeUserDataHome(),
    almaHome: homes.almaHome || defaultAlmaHome(),
    configuredAgentHomes: homes,
    maxItems: 1000,
    stalePolicy: "off",
    showArchivedCodex: false,
    showArchivedOpenCode: false,
    showSubagentCodex: false,
    showSubagentGrok: false,
    showArchivedCursorIde: false,
    showSubagentCursorIde: false,
    showIncognitoAlma: false,
    showSubagentAlma: false,
    showTempWorkspaceAlma: false
  };
}

test("renaming sessions does not change updatedAt, recent sort order, or per-session file mtime", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-resume-rename-time-"));
  try {
    const panelHome = path.join(root, "panel");
    const homes = {
      panelHome,
      codexHome: path.join(root, "codex"),
      claudeHome: path.join(root, "claude"),
      antigravityHome: path.join(root, "agy"),
      grokHome: path.join(root, "grok"),
      opencodeHome: path.join(root, "opencode"),
      piHome: path.join(root, "pi"),
      primeHome: path.join(root, "prime"),
      ompHome: path.join(root, "omp"),
      cursorHome: path.join(root, "cursor"),
      cursorIdeUserDataHome: path.join(root, "cursor-ide-user"),
      almaHome: path.join(root, "alma")
    };
    await Promise.all(Object.values(homes).map((dir) => mkdir(dir, { recursive: true })));
    process.env.ALMA_API_URL = "http://127.0.0.1:1";

    // Older timestamps well in the past so any Date.now() leak jumps to top.
    const tCodex = 1_700_000_010_000;
    const tClaude = 1_700_000_020_000;
    const tAgy = 1_700_000_030_000;
    const tGrok = 1_700_000_040_000;
    const tOpenCode = 1_700_000_050_000;
    const tPi = 1_700_000_060_000;
    const tOmp = 1_700_000_070_000;
    const tAlma = 1_700_000_075_000;
    const tChat = 1_700_000_080_000;
    const tNewest = 1_700_000_090_000;

    // Codex (with newer sentinel codex-newest to verify sort order stays intact)
    const codexDb = path.join(homes.codexHome, "state_1.sqlite");
    sqlite(
      codexDb,
      `CREATE TABLE threads(id TEXT,title TEXT,cwd TEXT,updated_at_ms INTEGER,updated_at INTEGER,model TEXT,git_branch TEXT,archived INTEGER,source TEXT,preview TEXT,first_user_message TEXT);
       INSERT INTO threads VALUES('codex-old','Codex Old','/tmp/codex',${tCodex},NULL,'gpt','main',0,NULL,NULL,NULL);
       INSERT INTO threads VALUES('codex-newest','Codex Newest','/tmp/codex',${tNewest},NULL,'gpt','main',0,NULL,NULL,NULL);`
    );
    const codexIndex = path.join(homes.codexHome, "session_index.jsonl");
    await jsonl(codexIndex, [{ id: "codex-old", thread_name: "Codex Old", updated_at: new Date(tCodex).toISOString() }]);
    const pastTime = new Date(1_700_000_000_000);
    await utimes(codexIndex, pastTime, pastTime);

    // Claude
    await jsonl(path.join(homes.claudeHome, "projects", "-tmp-claude", "claude-1.jsonl"), [
      { type: "user", sessionId: "claude-1", cwd: "/tmp/claude", timestamp: new Date(tClaude).toISOString(), message: { content: "Claude prompt" } }
    ]);

    // Agy (history + brain task.md)
    await jsonl(path.join(homes.antigravityHome, "history.jsonl"), [
      { conversationId: "agy-1", display: "Agy prompt", workspace: "/tmp/agy", timestamp: tAgy }
    ]);
    const brainTaskPath = path.join(homes.antigravityHome, "brain", "agy-brain-1", "task.md");
    await mkdir(path.dirname(brainTaskPath), { recursive: true });
    await writeFile(brainTaskPath, "# Old Brain Title\n\nBody\n", "utf8");
    await utimes(brainTaskPath, pastTime, pastTime);

    // Grok (without updated_at so loadGrok relies on file mtime)
    const grokSummary = path.join(homes.grokHome, "sessions", "group", "grok-1", "summary.json");
    await mkdir(path.dirname(grokSummary), { recursive: true });
    await writeFile(
      grokSummary,
      JSON.stringify({ info: { id: "grok-1", cwd: "/tmp/grok" }, generated_title: "Grok old", num_chat_messages: 3 }),
      "utf8"
    );
    await jsonl(path.join(path.dirname(grokSummary), "chat_history.jsonl"), [{ role: "user", content: "hi" }]);
    await utimes(grokSummary, new Date(tGrok), new Date(tGrok));

    // OpenCode
    const opencodeDb = path.join(homes.opencodeHome, "opencode.db");
    sqlite(
      opencodeDb,
      `CREATE TABLE session(id TEXT,directory TEXT,title TEXT,time_updated INTEGER,time_archived INTEGER,model TEXT);
       INSERT INTO session VALUES('opencode-1','/tmp/opencode','OpenCode old',${tOpenCode},NULL,NULL);`
    );

    // Alma
    const almaDb = path.join(homes.almaHome, "chat_threads.db");
    const almaIso = new Date(tAlma).toISOString();
    sqlite(
      almaDb,
      `CREATE TABLE workspaces(id TEXT PRIMARY KEY,path TEXT NOT NULL,name TEXT NOT NULL,is_temporary INTEGER NOT NULL DEFAULT 0);
       CREATE TABLE chat_threads(id TEXT PRIMARY KEY,title TEXT NOT NULL,model TEXT,is_incognito INTEGER DEFAULT 0,workspace_id TEXT,parent_thread_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
       CREATE TABLE chat_messages(id TEXT PRIMARY KEY,thread_id TEXT NOT NULL,message TEXT NOT NULL,timestamp TEXT NOT NULL,created_at TEXT NOT NULL);
       INSERT INTO workspaces VALUES('ws-1','/tmp/alma','alma',0);
       INSERT INTO chat_threads VALUES('alma-1','Alma old','magpie:test',0,'ws-1',NULL,'${almaIso}','${almaIso}');`
    );

    // Pi & OMP
    const piFile = path.join(homes.piHome, "sessions", "pi-1.jsonl");
    await jsonl(piFile, [
      { type: "session", id: "pi-1", cwd: "/tmp/pi", timestamp: new Date(tPi - 1000).toISOString() },
      { type: "message", timestamp: new Date(tPi).toISOString(), message: { role: "user", content: "Pi prompt" } }
    ]);
    await utimes(piFile, pastTime, pastTime);

    const ompFile = path.join(homes.ompHome, "sessions", "omp-1.jsonl");
    await jsonl(ompFile, [
      { type: "title", v: 1, title: "OMP old", updatedAt: new Date(tOmp).toISOString() },
      { type: "session", version: 3, id: "omp-1", cwd: "/tmp/omp", timestamp: new Date(tOmp - 1000).toISOString() },
      { type: "message", timestamp: new Date(tOmp).toISOString(), message: { role: "user", content: [{ type: "text", text: "OMP prompt" }] } }
    ]);
    await utimes(ompFile, pastTime, pastTime);

    // ACP chat
    const dbPath = catalogDbPath(panelHome);
    await ensureExtensionCatalogSchema(dbPath);
    const acpRecord = {
      id: "chat-1",
      title: "ACP old",
      projectPath: "/tmp/acp",
      provider: "claude",
      createdAt: tChat - 1000,
      updatedAt: tChat,
      messageCount: 4
    };
    await insertAcpSessionRecord(panelHome, acpRecord);
    await upsertAcpSessionInCatalog(dbPath, panelHome, {
      id: acpRecord.id,
      title: acpRecord.title,
      projectPath: acpRecord.projectPath,
      acpProvider: acpRecord.provider,
      updatedAt: acpRecord.updatedAt,
      messageCount: acpRecord.messageCount
    });

    const syncOptions = buildSyncOptions(panelHome, homes);
    await syncAgentSessions(syncOptions);

    const beforeRows = await runSqliteJson(
      dbPath,
      "SELECT provider, agent_session_id, updated_at_ms FROM sessions ORDER BY updated_at_ms DESC, provider ASC, agent_session_id ASC;"
    );
    const beforeMap = new Map(beforeRows.map((r) => [`${r.provider}:${r.agent_session_id}`, Number(r.updated_at_ms)]));
    assert.equal(beforeRows[0].agent_session_id, "codex-newest");

    const beforeMtimes = {
      codexIndex: (await stat(codexIndex)).mtimeMs,
      brainTask: (await stat(brainTaskPath)).mtimeMs,
      grokSummary: (await stat(grokSummary)).mtimeMs,
      piFile: (await stat(piFile)).mtimeMs,
      ompFile: (await stat(ompFile)).mtimeMs
    };

    // Rename every non-sentinel session
    const targets = [
      { provider: "codex", id: "codex-old", title: "Codex Old", projectPath: "/tmp/codex", updatedAt: tCodex },
      { provider: "claude", id: "claude-1", title: "Claude prompt", projectPath: "/tmp/claude", updatedAt: tClaude },
      { provider: "agy", id: "agy-1", title: "Agy prompt", projectPath: "/tmp/agy", updatedAt: tAgy },
      { provider: "grok", id: "grok-1", title: "Grok old", projectPath: "/tmp/grok", updatedAt: tGrok },
      { provider: "opencode", id: "opencode-1", title: "OpenCode old", projectPath: "/tmp/opencode", updatedAt: tOpenCode },
      { provider: "pi", id: "pi-1", title: "Pi prompt", projectPath: "/tmp/pi", updatedAt: tPi },
      { provider: "omp", id: "omp-1", title: "OMP old", projectPath: "/tmp/omp", updatedAt: tOmp },
      { provider: "alma", id: "alma-1", title: "Alma old", projectPath: "/tmp/alma", updatedAt: tAlma },
      { provider: "chat", id: "chat-1", title: "ACP old", projectPath: "/tmp/acp", updatedAt: tChat }
    ];

    for (const session of targets) {
      const nextTitle = `Auto Renamed ${session.id}`;
      if (session.provider !== "chat") {
        const updated = await setUserTitleIfUnsetInCatalog(dbPath, session.provider, session.id, nextTitle);
        assert.equal(updated, true);
      }
      await renameSession(session, nextTitle, homes);
    }
    await renameSession(
      { provider: "agy", id: "agy-brain-1", title: "Old Brain Title", projectPath: "/tmp/agy", updatedAt: tAgy, source: "brain" },
      "Auto Renamed agy-brain-1",
      homes
    );

    // File mtimes must remain unchanged
    assert.equal((await stat(codexIndex)).mtimeMs, beforeMtimes.codexIndex, "codex session_index mtime");
    assert.equal((await stat(brainTaskPath)).mtimeMs, beforeMtimes.brainTask, "agy brain task.md mtime");
    assert.equal((await stat(grokSummary)).mtimeMs, beforeMtimes.grokSummary, "grok summary.json mtime");
    assert.equal((await stat(piFile)).mtimeMs, beforeMtimes.piFile, "pi jsonl mtime");
    assert.equal((await stat(ompFile)).mtimeMs, beforeMtimes.ompFile, "omp jsonl mtime");

    // Re-sync and verify updated_at_ms & sort order did not change
    await syncAgentSessions(syncOptions);
    const afterRows = await runSqliteJson(
      dbPath,
      "SELECT provider, agent_session_id, updated_at_ms, user_title, title, transcript_kind FROM sessions ORDER BY updated_at_ms DESC, provider ASC, agent_session_id ASC;"
    );

    assert.deepEqual(
      afterRows.map((r) => `${r.provider}:${r.agent_session_id}`),
      beforeRows.map((r) => `${r.provider}:${r.agent_session_id}`),
      "recent session sort order must remain unchanged"
    );
    for (const row of afterRows) {
      const key = `${row.provider}:${row.agent_session_id}`;
      assert.equal(Number(row.updated_at_ms), beforeMap.get(key), `updated_at_ms changed for ${key}`);
    }

    const claudeRow = afterRows.find((r) => r.provider === "claude" && r.agent_session_id === "claude-1");
    assert.equal(claudeRow?.transcript_kind, "jsonl", "claude transcript_kind must survive rename + resync");

    const ompContent = await readFile(ompFile, "utf8");
    const ompTitleLine = JSON.parse(ompContent.split("\n")[0]);
    assert.equal(ompTitleLine.title, "Auto Renamed omp-1");
    assert.equal(ompTitleLine.updatedAt, new Date(tOmp).toISOString());

    const acpAfter = await loadAcpSessionRecords(panelHome);
    assert.equal(acpAfter[0].title, "Auto Renamed chat-1");
    assert.equal(acpAfter[0].updatedAt, tChat);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
