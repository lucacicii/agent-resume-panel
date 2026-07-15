import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  listSessions,
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

test("syncs seven providers, preserves local enhancements, and isolates provider failures", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-resume-sync-"));
  const homes = {
    codexHome: path.join(root, "codex"),
    claudeHome: path.join(root, "claude"),
    antigravityHome: path.join(root, "agy"),
    grokHome: path.join(root, "grok"),
    almaDataDir: path.join(root, "alma"),
    opencodeHome: path.join(root, "opencode"),
    piHome: path.join(root, "pi")
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

  const almaDb = path.join(homes.almaDataDir, "chat_threads.db");
  sqlite(almaDb, "CREATE TABLE workspaces(id TEXT,path TEXT,name TEXT); CREATE TABLE chat_threads(id TEXT,title TEXT,updated_at TEXT,model TEXT,is_incognito INTEGER,workspace_id TEXT); CREATE TABLE chat_messages(thread_id TEXT); INSERT INTO workspaces VALUES('w','/tmp/alma','Alma'); INSERT INTO chat_threads VALUES('alma-1','Alma title','2026-01-01T00:00:05Z','alma-model',0,'w'); INSERT INTO chat_messages VALUES('alma-1');");
  const opencodeDb = path.join(homes.opencodeHome, "opencode.db");
  sqlite(opencodeDb, "CREATE TABLE session(id TEXT,directory TEXT,title TEXT,time_updated INTEGER,time_archived INTEGER,model TEXT); INSERT INTO session VALUES('opencode-1','/tmp/opencode','OpenCode title',6000,NULL,NULL);");
  await jsonl(path.join(homes.piHome, "sessions", "pi-1.jsonl"), [
    { type: "session", id: "pi-1", cwd: "/tmp/pi", timestamp: "2026-01-01T00:00:07Z" },
    { type: "message", timestamp: "2026-01-01T00:00:08Z", message: { role: "user", content: "Pi title" } }
  ]);

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
  assert.equal(first.providers.filter((provider) => provider.status === "ok").length, 7);
  assert.deepEqual(new Set(first.sessions.map((item) => item.provider)), new Set(["codex", "claude", "agy", "grok", "alma", "opencode", "pi"]));

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
