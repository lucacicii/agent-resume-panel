import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  listSessions,
  loadAllAgentSessions,
  runSqliteJson,
  sessionSyncOptionsFromSettings,
  syncAgentSessions
} from "../dist/index.js";

function sqlite(dbPath, sql) {
  execFileSync("sqlite3", [dbPath, sql]);
}

async function jsonl(file, rows) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

test("fresh install with default agent homes does not warn about missing directories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-resume-fresh-"));
  const settings = {
    panelHome: path.join(root, "panel"),
    llm: { baseUrl: "http://localhost", model: "test" },
    embedding: { model: "test" },
    agentHomes: {
      codexHome: "~/.codex",
      claudeHome: "~/.claude",
      antigravityHome: "~/.gemini",
      grokHome: "~/.grok",
      opencodeHome: "~/.local/share/opencode",
      piHome: "~/.pi/agent"
    }
  };
  const result = await loadAllAgentSessions(sessionSyncOptionsFromSettings(settings));
  assert.equal(result.warnings.length, 0);
  assert.equal(result.providers.every((provider) => provider.status === "ok"), true);
});

test("explicit missing agent home still warns", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-resume-explicit-"));
  const missing = path.join(root, "missing-claude");
  const settings = {
    panelHome: path.join(root, "panel"),
    llm: { baseUrl: "http://localhost", model: "test" },
    embedding: { model: "test" },
    agentHomes: {
      claudeHome: missing
    }
  };
  const result = await loadAllAgentSessions(sessionSyncOptionsFromSettings(settings));
  assert.ok(result.warnings.some((warning) => warning.includes("Claude data directory not found")));
});

test("syncs eight providers, preserves local enhancements, and isolates provider failures", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-resume-sync-"));
  const homes = {
    codexHome: path.join(root, "codex"),
    claudeHome: path.join(root, "claude"),
    antigravityHome: path.join(root, "agy"),
    grokHome: path.join(root, "grok"),
    opencodeHome: path.join(root, "opencode"),
    piHome: path.join(root, "pi"),
    cursorHome: path.join(root, "cursor"),
    cursorIdeUserDataHome: path.join(root, "cursor-ide-user")
  };
  await Promise.all(Object.values(homes).map((dir) => mkdir(dir, { recursive: true })));

  const codexDb = path.join(homes.codexHome, "state_1.sqlite");
  sqlite(codexDb, "CREATE TABLE threads(id TEXT,title TEXT,cwd TEXT,updated_at_ms INTEGER,updated_at INTEGER,model TEXT,git_branch TEXT,archived INTEGER,source TEXT,preview TEXT,first_user_message TEXT); INSERT INTO threads VALUES('codex-1','Codex native','/tmp/codex',1000,NULL,'gpt','main',0,NULL,NULL,NULL);");
  await jsonl(path.join(homes.codexHome, "sessions", "rollout-codex-1.jsonl"), [{ type: "message" }]);
  await jsonl(path.join(homes.claudeHome, "projects", "-tmp-claude", "claude-1.jsonl"), [
    { type: "user", sessionId: "claude-1", cwd: "/tmp/claude", timestamp: "2026-01-01T00:00:02Z", message: { content: "Claude title" } }
  ]);
  await jsonl(path.join(homes.antigravityHome, "history.jsonl"), [
    { conversationId: "agy-1", display: "Agy title", workspace: "/tmp/agy", timestamp: 3000 }
  ]);
  const grokDir = path.join(homes.grokHome, "sessions", "group", "grok-1");
  await mkdir(grokDir, { recursive: true });
  await writeFile(path.join(grokDir, "summary.json"), JSON.stringify({ info: { id: "grok-1", cwd: "/tmp/grok" }, generated_title: "Grok title", updated_at: "2026-01-01T00:00:04Z", num_chat_messages: 2 }));
  await jsonl(path.join(grokDir, "chat_history.jsonl"), [{ role: "user", content: "hello" }]);

  const opencodeDb = path.join(homes.opencodeHome, "opencode.db");
  sqlite(opencodeDb, "CREATE TABLE session(id TEXT,directory TEXT,title TEXT,time_updated INTEGER,time_archived INTEGER,model TEXT); INSERT INTO session VALUES('opencode-1','/tmp/opencode','OpenCode title',6000,NULL,NULL);");
  await jsonl(path.join(homes.piHome, "sessions", "pi-1.jsonl"), [
    { type: "session", id: "pi-1", cwd: "/tmp/pi", timestamp: "2026-01-01T00:00:07Z" },
    { type: "message", timestamp: "2026-01-01T00:00:08Z", message: { role: "user", content: "Pi title" } }
  ]);
  await mkdir(path.join(homes.cursorHome, "chats", "workspace-a", "cursor-1"), { recursive: true });
  await writeFile(
    path.join(homes.cursorHome, "chats", "workspace-a", "cursor-1", "meta.json"),
    JSON.stringify({ schemaVersion: 1, title: "Cursor CLI title", cwd: "/tmp/cursor", createdAtMs: 7000, updatedAtMs: 8000, hasConversation: true })
  );
  await jsonl(path.join(homes.cursorHome, "projects", "project-a", "agent-transcripts", "cursor-1", "cursor-1.jsonl"), [
    { role: "user", message: { content: [{ type: "text", text: "Cursor prompt" }] } },
    { role: "assistant", message: { content: [{ type: "text", text: "Cursor answer" }] } }
  ]);
  const cursorIdeDb = path.join(homes.cursorIdeUserDataHome, "globalStorage", "state.vscdb");
  await mkdir(path.dirname(cursorIdeDb), { recursive: true });
  sqlite(cursorIdeDb, `CREATE TABLE composerHeaders(composerId TEXT,workspaceId TEXT,createdAt INTEGER,lastUpdatedAt INTEGER,isArchived INTEGER,isSubagent INTEGER,recency INTEGER,checkpointAt INTEGER,value TEXT);
    INSERT INTO composerHeaders VALUES('cursor-ide-1','workspace-a',9000,10000,0,0,10000,NULL,'{"name":"Cursor IDE title","subtitle":"Cursor IDE subtitle"}');`);
  await mkdir(path.join(homes.cursorIdeUserDataHome, "workspaceStorage", "workspace-a"), { recursive: true });
  await writeFile(path.join(homes.cursorIdeUserDataHome, "workspaceStorage", "workspace-a", "workspace.json"), JSON.stringify({ folder: "file:///tmp/cursor-ide" }));

  const settings = {
    panelHome: path.join(root, "panel"),
    llm: { baseUrl: "http://localhost", model: "test" },
    embedding: { model: "test" },
    agentHomes: homes,
    sessionSync: { maxItems: 10000, stalePolicy: "off" }
  };
  const options = sessionSyncOptionsFromSettings(settings);
  const firstPromise = syncAgentSessions(options);
  assert.equal(syncAgentSessions(options), firstPromise, "concurrent calls share one task");
  const first = await firstPromise;
  assert.equal(first.providers.filter((provider) => provider.status === "ok").length, 8);
  assert.deepEqual(new Set(first.sessions.map((item) => item.provider)), new Set(["codex", "claude", "agy", "grok", "opencode", "pi", "cursor", "cursor-ide"]));
  const cursor = first.sessions.find((item) => item.provider === "cursor");
  assert.equal(cursor?.title, "Cursor CLI title");
  assert.equal(cursor?.projectPath, "/tmp/cursor");
  const cursorIde = first.sessions.find((item) => item.provider === "cursor-ide");
  assert.equal(cursorIde?.title, "Cursor IDE title");
  assert.equal(cursorIde?.projectPath, "/tmp/cursor-ide");
  assert.equal(cursorIde?.source, "cursor-ide-header");

  sqlite(options.dbPath, "UPDATE sessions SET user_title='Pinned title',session_summary='Keep summary',session_summary_language='English' WHERE provider='codex' AND agent_session_id='codex-1'; INSERT INTO session_gtd(provider,agent_session_id,status,updated_at_ms) VALUES('codex','codex-1','doing',1);");
  sqlite(codexDb, "UPDATE threads SET title='Codex native updated' WHERE id='codex-1';");
  await syncAgentSessions(options);
  const visible = await listSessions(options.dbPath, 100);
  const codex = visible.find((item) => item.provider === "codex");
  assert.equal(codex?.title, "Pinned title");
  assert.equal(codex?.sessionSummary, "Keep summary");
  const rows = await runSqliteJson(options.dbPath, "SELECT title,user_title,session_summary FROM sessions WHERE provider='codex' AND agent_session_id='codex-1';");
  assert.equal(rows[0].title, "Codex native updated");
  assert.equal(rows[0].user_title, "Pinned title");

  sqlite(options.dbPath, "UPDATE sessions SET hidden=1 WHERE provider='codex' AND agent_session_id='codex-1';");
  await syncAgentSessions(options);
  assert.ok(!(await listSessions(options.dbPath, 100)).some((item) => item.id === "codex-1"));
  const hiddenRows = await runSqliteJson(options.dbPath, "SELECT hidden FROM sessions WHERE provider='codex' AND agent_session_id='codex-1';");
  assert.equal(hiddenRows[0].hidden, 1);

  await writeFile(opencodeDb, "not a sqlite database", "utf8");
  const failed = await syncAgentSessions(options);
  assert.equal(failed.providers.find((item) => item.provider === "opencode")?.status, "error");
  assert.ok((await listSessions(options.dbPath, 100)).some((item) => item.id === "opencode-1"), "failed provider keeps old catalog rows");
});

test("purgeRetiredAlmaCatalog deletes Alma sessions and Alma-only projects", async () => {
  const { purgeRetiredAlmaCatalog, listSessions } = await import("../dist/index.js");
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-resume-alma-purge-"));
  const dbPath = path.join(root, "catalog.db");
  // Minimal schema used by purge + list
  sqlite(
    dbPath,
    `CREATE TABLE sessions(
      provider TEXT NOT NULL, agent_session_id TEXT NOT NULL, title TEXT NOT NULL, project_path TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0, message_count INTEGER, model TEXT, branch TEXT,
      source TEXT, acp_provider TEXT, user_title TEXT, hidden INTEGER NOT NULL DEFAULT 0, last_synced_at_ms INTEGER,
      transcript_kind TEXT, transcript_refs TEXT, session_summary TEXT, session_summary_language TEXT, session_summary_at_ms INTEGER,
      project_id TEXT, PRIMARY KEY (provider, agent_session_id)
    );
    CREATE TABLE projects(project_id TEXT PRIMARY KEY, portable_key TEXT NOT NULL UNIQUE, alias TEXT NOT NULL DEFAULT '', hidden INTEGER NOT NULL DEFAULT 0, last_seen_at_ms INTEGER, updated_at_ms INTEGER NOT NULL, pinned INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE project_local_paths(project_id TEXT NOT NULL, machine_id TEXT NOT NULL, absolute_path TEXT NOT NULL, updated_at_ms INTEGER NOT NULL, PRIMARY KEY(project_id, machine_id));
    CREATE TABLE session_gtd(provider TEXT NOT NULL, agent_session_id TEXT NOT NULL, status TEXT, updated_at_ms INTEGER NOT NULL, PRIMARY KEY(provider, agent_session_id));
    CREATE TABLE sync_state(provider TEXT PRIMARY KEY, last_sync_at_ms INTEGER);
    INSERT INTO projects VALUES('proj-alma-only','~/Library/Application Support/alma/workspaces/temp-x','',0,1,1,0);
    INSERT INTO projects VALUES('proj-mixed','~/wb/mixed','',0,1,1,0);
    INSERT INTO project_local_paths VALUES('proj-alma-only','m1','/tmp/alma-only',1);
    INSERT INTO sessions VALUES('alma','a1','Alma only','/tmp/alma-only',1,0,NULL,NULL,NULL,NULL,NULL,NULL,0,NULL,NULL,NULL,NULL,NULL,NULL,'proj-alma-only');
    INSERT INTO sessions VALUES('alma','a2','Alma mixed','/tmp/mixed',2,0,NULL,NULL,NULL,NULL,NULL,NULL,0,NULL,NULL,NULL,NULL,NULL,NULL,'proj-mixed');
    INSERT INTO sessions VALUES('codex','c1','Codex mixed','/tmp/mixed',3,0,NULL,NULL,NULL,NULL,NULL,NULL,0,NULL,NULL,NULL,NULL,NULL,NULL,'proj-mixed');
    INSERT INTO session_gtd VALUES('alma','a1','doing',1);
    INSERT INTO sync_state VALUES('alma',1);`
  );

  const result = await purgeRetiredAlmaCatalog(dbPath);
  assert.equal(result.deletedSessions, 2);
  assert.equal(result.deletedProjects, 1);

  const almaLeft = await runSqliteJson(dbPath, "SELECT COUNT(*) AS c FROM sessions WHERE provider='alma';");
  assert.equal(Number(almaLeft[0].c), 0);
  const almaProject = await runSqliteJson(dbPath, "SELECT COUNT(*) AS c FROM projects WHERE project_id='proj-alma-only';");
  assert.equal(Number(almaProject[0].c), 0);
  const mixed = await runSqliteJson(dbPath, "SELECT COUNT(*) AS c FROM projects WHERE project_id='proj-mixed';");
  assert.equal(Number(mixed[0].c), 1);
  const codex = await listSessions(dbPath, 10);
  assert.equal(codex.length, 1);
  assert.equal(codex[0].provider, "codex");
  const gtd = await runSqliteJson(dbPath, "SELECT COUNT(*) AS c FROM session_gtd WHERE provider='alma';");
  assert.equal(Number(gtd[0].c), 0);
  const sync = await runSqliteJson(dbPath, "SELECT COUNT(*) AS c FROM sync_state WHERE provider='alma';");
  assert.equal(Number(sync[0].c), 0);
});
