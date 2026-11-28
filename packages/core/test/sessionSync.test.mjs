import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_AGENT_HOMES,
  catalogDbPath,
  defaultAlmaHome,
  defaultCursorIdeUserDataHome,
  expandHome,
  loadAllAgentSessions,
  moveSessionToProjectInCatalog,
  resolvePanelHome,
  runSqliteJson,
  syncAgentSessions
} from "../dist/index.js";

function buildSyncOptions(settings, overrides = {}) {
  const homes = settings.agentHomes || {};
  const panelHome = resolvePanelHome(settings.panelHome);
  const sync = settings.sessionSync || {};
  return {
    dbPath: catalogDbPath(panelHome),
    panelHome,
    codexHome: expandHome(homes.codexHome || DEFAULT_AGENT_HOMES.codexHome),
    claudeHome: expandHome(homes.claudeHome || DEFAULT_AGENT_HOMES.claudeHome),
    antigravityHome: expandHome(homes.antigravityHome || DEFAULT_AGENT_HOMES.antigravityHome),
    grokHome: expandHome(homes.grokHome || DEFAULT_AGENT_HOMES.grokHome),
    opencodeHome: expandHome(homes.opencodeHome || DEFAULT_AGENT_HOMES.opencodeHome),
    piHome: expandHome(homes.piHome || DEFAULT_AGENT_HOMES.piHome),
    primeHome: expandHome(homes.primeHome || DEFAULT_AGENT_HOMES.primeHome),
    ompHome: expandHome(homes.ompHome || DEFAULT_AGENT_HOMES.ompHome),
    cursorHome: expandHome(homes.cursorHome || DEFAULT_AGENT_HOMES.cursorHome),
    cursorIdeUserDataHome: expandHome(homes.cursorIdeUserDataHome || defaultCursorIdeUserDataHome()),
    almaHome: expandHome(homes.almaHome || defaultAlmaHome()),
    configuredAgentHomes: settings.agentHomes,
    maxItems: sync.maxItems ?? 10_000,
    stalePolicy: sync.stalePolicy || "off",
    showArchivedCodex: sync.showArchivedCodex === true,
    showArchivedOpenCode: sync.showArchivedOpenCode === true,
    showSubagentCodex: sync.showSubagentCodex === true,
    showSubagentGrok: sync.showSubagentGrok === true,
    showArchivedCursorIde: sync.showArchivedCursorIde === true,
    showSubagentCursorIde: sync.showSubagentCursorIde === true,
    showIncognitoAlma: sync.showIncognitoAlma === true,
    showSubagentAlma: sync.showSubagentAlma === true,
    showTempWorkspaceAlma: sync.showTempWorkspaceAlma === true,
    ...overrides
  };
}

async function listVisibleSessions(dbPath, limit = 100) {
  const rows = await runSqliteJson(
    dbPath,
    `SELECT provider, agent_session_id, COALESCE(NULLIF(TRIM(user_title), ''), title) AS display_title,
            project_path, native_project_path, session_summary
     FROM sessions WHERE hidden = 0 ORDER BY updated_at_ms DESC LIMIT ${limit};`
  );
  return rows.map((row) => ({
    provider: row.provider,
    id: row.agent_session_id,
    title: row.display_title,
    projectPath: row.project_path,
    nativeProjectPath: row.native_project_path || undefined,
    projectOverridden: Boolean(row.native_project_path && row.native_project_path !== row.project_path),
    sessionSummary: row.session_summary || undefined
  }));
}

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
  const result = await loadAllAgentSessions(buildSyncOptions(settings));
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
  const result = await loadAllAgentSessions(buildSyncOptions(settings));
  assert.ok(result.warnings.some((warning) => warning.includes("Claude data directory not found")));
});

test("syncs ten providers, preserves local enhancements, and isolates provider failures", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-resume-sync-"));
  const homes = {
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
  await jsonl(path.join(homes.primeHome, "sessions", "prime-1.jsonl"), [
    { type: "session", id: "prime-1", cwd: "/tmp/prime", timestamp: "2026-01-01T00:00:09Z" },
    { type: "message", timestamp: "2026-01-01T00:00:10Z", message: { role: "user", content: "Prime title" } }
  ]);
  await jsonl(path.join(homes.ompHome, "sessions", "-tmp-omp", "omp-1.jsonl"), [
    { type: "title", v: 1, title: "OMP title", updatedAt: "2026-01-01T00:00:11Z", pad: "   " },
    { type: "session", version: 3, id: "omp-1", cwd: "/tmp/omp", timestamp: "2026-01-01T00:00:10Z" },
    { type: "model_change", id: "mc1", timestamp: "2026-01-01T00:00:10Z", model: "magpie/step-5" },
    { type: "message", timestamp: "2026-01-01T00:00:11Z", message: { role: "user", content: [{ type: "text", text: "OMP first prompt" }] } }
  ]);
  await jsonl(path.join(homes.ompHome, "sessions", "-tmp-omp", "omp-1", "subagent.jsonl"), [
    { type: "session", version: 3, id: "omp-sub-1", cwd: "/tmp/omp", parentSession: "/tmp/omp/omp-1.jsonl", timestamp: "2026-01-01T00:00:12Z" },
    { type: "message", timestamp: "2026-01-01T00:00:12Z", message: { role: "user", content: [{ type: "text", text: "Subagent task" }] } }
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

  const almaDb = path.join(homes.almaHome, "chat_threads.db");
  sqlite(almaDb, `CREATE TABLE workspaces(id TEXT PRIMARY KEY,path TEXT NOT NULL,name TEXT NOT NULL,is_temporary INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE chat_threads(id TEXT PRIMARY KEY,title TEXT NOT NULL,model TEXT,is_incognito INTEGER DEFAULT 0,workspace_id TEXT,parent_thread_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE chat_messages(id TEXT PRIMARY KEY,thread_id TEXT NOT NULL,message TEXT NOT NULL,timestamp TEXT NOT NULL,created_at TEXT NOT NULL);
    INSERT INTO workspaces VALUES('ws-1','/tmp/alma','alma',0);
    INSERT INTO chat_threads VALUES('alma-1','Alma title','magpie:test',0,'ws-1',NULL,'2026-01-01T00:00:13Z','2026-01-01T00:00:14Z');
    INSERT INTO chat_messages VALUES('m-1','alma-1','{"role":"user","parts":[{"type":"text","text":"Alma prompt"}]}','2026-01-01T00:00:14Z','2026-01-01T00:00:14Z');`);

  const settings = {
    panelHome: path.join(root, "panel"),
    llm: { baseUrl: "http://localhost", model: "test" },
    embedding: { model: "test" },
    agentHomes: homes,
    sessionSync: { maxItems: 10000, stalePolicy: "off" }
  };
  const options = buildSyncOptions(settings);
  const firstPromise = syncAgentSessions(options);
  assert.equal(syncAgentSessions(options), firstPromise, "concurrent calls share one task");
  const first = await firstPromise;
  assert.equal(first.providers.filter((provider) => provider.status === "ok").length, 11);
  assert.deepEqual(new Set(first.sessions.map((item) => item.provider)), new Set(["codex", "claude", "agy", "grok", "opencode", "pi", "prime", "omp", "cursor", "cursor-ide", "alma"]));
  const alma = first.sessions.find((item) => item.provider === "alma");
  assert.equal(alma?.title, "Alma title");
  assert.equal(alma?.projectPath, "/tmp/alma");
  assert.equal(alma?.model, "magpie:test");
  assert.equal(alma?.messageCount, 1);
  const cursor = first.sessions.find((item) => item.provider === "cursor");
  assert.equal(cursor?.title, "Cursor CLI title");
  assert.equal(cursor?.projectPath, "/tmp/cursor");
  const prime = first.sessions.find((item) => item.provider === "prime");
  assert.equal(prime?.title, "Prime title");
  assert.equal(prime?.projectPath, "/tmp/prime");
  const omp = first.sessions.find((item) => item.provider === "omp");
  assert.equal(omp?.title, "OMP title");
  assert.equal(omp?.projectPath, "/tmp/omp");
  assert.equal(omp?.model, "magpie/step-5");
  const cursorIde = first.sessions.find((item) => item.provider === "cursor-ide");
  assert.equal(cursorIde?.title, "Cursor IDE title");
  assert.equal(cursorIde?.projectPath, "/tmp/cursor-ide");
  assert.equal(cursorIde?.source, "cursor-ide-header");

  sqlite(options.dbPath, "UPDATE sessions SET user_title='Pinned title',session_summary='Keep summary',session_summary_language='English' WHERE provider='codex' AND agent_session_id='codex-1'; INSERT INTO session_gtd(provider,agent_session_id,status,updated_at_ms) VALUES('codex','codex-1','doing',1);");
  sqlite(codexDb, "UPDATE threads SET title='Codex native updated' WHERE id='codex-1';");
  await syncAgentSessions(options);
  const visible = await listVisibleSessions(options.dbPath, 100);
  const codex = visible.find((item) => item.provider === "codex");
  assert.equal(codex?.title, "Pinned title");
  assert.equal(codex?.sessionSummary, "Keep summary");
  const rows = await runSqliteJson(options.dbPath, "SELECT title,user_title,session_summary FROM sessions WHERE provider='codex' AND agent_session_id='codex-1';");
  assert.equal(rows[0].title, "Codex native updated");
  assert.equal(rows[0].user_title, "Pinned title");

  // Not yet moved: a native cwd change must still follow into project_path.
  sqlite(codexDb, "UPDATE threads SET cwd='/tmp/codex-new' WHERE id='codex-1';");
  await syncAgentSessions(options);
  const tracking = await runSqliteJson(options.dbPath, "SELECT project_path, native_project_path FROM sessions WHERE provider='codex' AND agent_session_id='codex-1';");
  assert.equal(tracking[0].project_path, "/tmp/codex-new");
  assert.equal(tracking[0].native_project_path, "/tmp/codex-new");
  sqlite(codexDb, "UPDATE threads SET cwd='/tmp/codex' WHERE id='codex-1';");
  await syncAgentSessions(options);

  sqlite(options.dbPath, "UPDATE sessions SET hidden=1 WHERE provider='codex' AND agent_session_id='codex-1';");
  await syncAgentSessions(options);
  assert.ok(!(await listVisibleSessions(options.dbPath, 100)).some((item) => item.id === "codex-1"));
  const hiddenRows = await runSqliteJson(options.dbPath, "SELECT hidden FROM sessions WHERE provider='codex' AND agent_session_id='codex-1';");
  assert.equal(hiddenRows[0].hidden, 1);

  sqlite(options.dbPath, "UPDATE sessions SET hidden=0 WHERE provider='codex' AND agent_session_id='codex-1';");
  const moved = await moveSessionToProjectInCatalog(options.dbPath, "codex", "codex-1", "/tmp/moved-project");
  assert.equal(moved.moved, true);
  assert.equal(moved.newPath, "/tmp/moved-project");
  await syncAgentSessions(options);
  const afterMove = await listVisibleSessions(options.dbPath, 100);
  const movedCodex = afterMove.find((item) => item.provider === "codex" && item.id === "codex-1");
  assert.equal(movedCodex?.projectPath, "/tmp/moved-project");
  const overrideRows = await runSqliteJson(options.dbPath, "SELECT project_path, native_project_path FROM sessions WHERE provider='codex' AND agent_session_id='codex-1';");
  assert.equal(overrideRows[0].project_path, "/tmp/moved-project");
  assert.equal(overrideRows[0].native_project_path, "/tmp/codex");
  assert.equal(movedCodex?.nativeProjectPath, "/tmp/codex");
  assert.equal(movedCodex?.projectOverridden, true);

  // User moves the session back to its native path: the value rule resets and
  // the session starts tracking the native path again.
  await moveSessionToProjectInCatalog(options.dbPath, "codex", "codex-1", "/tmp/codex");
  await syncAgentSessions(options);
  const resetRows = await runSqliteJson(options.dbPath, "SELECT project_path, native_project_path FROM sessions WHERE provider='codex' AND agent_session_id='codex-1';");
  assert.equal(resetRows[0].project_path, "/tmp/codex");
  assert.equal(resetRows[0].native_project_path, "/tmp/codex");

  await writeFile(opencodeDb, "not a sqlite database", "utf8");
  const failed = await syncAgentSessions(options);
  assert.equal(failed.providers.find((item) => item.provider === "opencode")?.status, "error");
  assert.ok((await listVisibleSessions(options.dbPath, 100)).some((item) => item.id === "opencode-1"), "failed provider keeps old catalog rows");
});

test("Claude project_path uses first transcript cwd, not later Bash cd drift", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-resume-claude-cwd-"));
  const claudeHome = path.join(root, "claude");
  await mkdir(claudeHome, { recursive: true });
  // Claude keeps the jsonl under the start project folder even after shell cd.
  await jsonl(path.join(claudeHome, "projects", "-tmp-monorepo", "claude-drift.jsonl"), [
    {
      type: "user",
      sessionId: "claude-drift",
      cwd: "/tmp/monorepo",
      timestamp: "2026-01-01T00:00:01Z",
      message: { content: "start at monorepo root" }
    },
    {
      type: "assistant",
      sessionId: "claude-drift",
      cwd: "/tmp/monorepo",
      timestamp: "2026-01-01T00:00:02Z",
      message: { content: [{ type: "tool_use", name: "Bash", input: { command: "cd apps/extension && pnpm test" } }] }
    },
    {
      type: "user",
      sessionId: "claude-drift",
      cwd: "/tmp/monorepo/apps/extension",
      timestamp: "2026-01-01T00:00:03Z",
      message: { content: [{ type: "tool_result", content: "ok" }] }
    },
    {
      type: "assistant",
      sessionId: "claude-drift",
      cwd: "/tmp/monorepo/apps/extension",
      timestamp: "2026-01-01T00:00:04Z",
      message: { content: "done" }
    }
  ]);

  const settings = {
    panelHome: path.join(root, "panel"),
    llm: { baseUrl: "http://localhost", model: "test" },
    embedding: { model: "test" },
    agentHomes: { claudeHome },
    sessionSync: { maxItems: 10000, stalePolicy: "off" }
  };
  const options = buildSyncOptions(settings);
  const result = await syncAgentSessions(options);
  const session = result.sessions.find((item) => item.id === "claude-drift");
  assert.equal(session?.projectPath, "/tmp/monorepo");
  const rows = await runSqliteJson(
    options.dbPath,
    "SELECT project_path FROM sessions WHERE provider='claude' AND agent_session_id='claude-drift';"
  );
  assert.equal(rows[0]?.project_path, "/tmp/monorepo");
});

test("keeps Codex ACP threads out of CLI sessions and removes existing catalog duplicates", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-resume-codex-acp-"));
  const homes = {
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

  const knownAcpId = "11111111-1111-4111-8111-111111111111";
  const originatorAcpId = "22222222-2222-4222-8222-222222222222";
  const vscodeId = "33333333-3333-4333-8333-333333333333";
  const malformedId = "44444444-4444-4444-8444-444444444444";
  const codexDb = path.join(homes.codexHome, "state_1.sqlite");
  sqlite(codexDb, `
    CREATE TABLE threads(id TEXT,title TEXT,cwd TEXT,updated_at_ms INTEGER,updated_at INTEGER,model TEXT,git_branch TEXT,archived INTEGER,source TEXT,preview TEXT,first_user_message TEXT);
    INSERT INTO threads VALUES('${knownAcpId}','Known ACP','/tmp/acp',4000,NULL,'gpt',NULL,0,'unknown',NULL,NULL);
    INSERT INTO threads VALUES('${originatorAcpId}','Originator ACP','/tmp/acp',3000,NULL,'gpt',NULL,0,'vscode',NULL,NULL);
    INSERT INTO threads VALUES('${vscodeId}','VS Code','/tmp/vscode',2000,NULL,'gpt',NULL,0,'vscode',NULL,NULL);
    INSERT INTO threads VALUES('${malformedId}','Malformed rollout','/tmp/vscode',1000,NULL,'gpt',NULL,0,'vscode',NULL,NULL);
  `);
  await jsonl(path.join(homes.codexHome, "sessions", `rollout-${knownAcpId}.jsonl`), [
    { type: "session_meta", payload: { id: knownAcpId, originator: "codex_cli_rs", source: "unknown" } }
  ]);
  await jsonl(path.join(homes.codexHome, "sessions", `rollout-${originatorAcpId}.jsonl`), [
    { type: "session_meta", payload: { id: originatorAcpId, originator: "@agentclientprotocol/codex-acp", source: "vscode" } }
  ]);
  await jsonl(path.join(homes.codexHome, "sessions", `rollout-${vscodeId}.jsonl`), [
    { type: "session_meta", payload: { id: vscodeId, originator: "codex_vscode", source: "vscode" } }
  ]);
  await mkdir(path.join(homes.codexHome, "sessions"), { recursive: true });
  await writeFile(path.join(homes.codexHome, "sessions", `rollout-${malformedId}.jsonl`), "not-json\n", "utf8");

  const panelHome = path.join(root, "panel");
  await jsonl(path.join(panelHome, "acp", "sessions.jsonl"), [{
    id: "chat-1",
    title: "ACP chat",
    projectPath: "/tmp/acp",
    provider: "codex",
    acpSessionId: knownAcpId,
    createdAt: 1,
    updatedAt: 4,
    messageCount: 1
  }]);
  const settings = {
    panelHome,
    llm: { baseUrl: "http://localhost", model: "test" },
    embedding: { model: "test" },
    agentHomes: homes,
    sessionSync: { maxItems: 10000, stalePolicy: "off" }
  };
  const options = buildSyncOptions(settings);
  const first = await syncAgentSessions(options);
  const codexIds = first.sessions.filter((item) => item.provider === "codex").map((item) => item.id);
  assert.deepEqual(new Set(codexIds), new Set([vscodeId, malformedId]));

  sqlite(options.dbPath, `
    INSERT INTO sessions(provider,agent_session_id,title,project_path,updated_at_ms,archived,hidden)
      VALUES('codex','${knownAcpId}','Duplicate known ACP','/tmp/acp',1,0,0);
    INSERT INTO sessions(provider,agent_session_id,title,project_path,updated_at_ms,archived,hidden)
      VALUES('codex','${originatorAcpId}','Duplicate originator ACP','/tmp/acp',1,0,0);
  `);
  await syncAgentSessions(options);

  const duplicateRows = await runSqliteJson(
    options.dbPath,
    `SELECT agent_session_id FROM sessions WHERE provider='codex' AND agent_session_id IN ('${knownAcpId}','${originatorAcpId}');`
  );
  assert.equal(duplicateRows.length, 0);
  const acpRows = await runSqliteJson(
    options.dbPath,
    "SELECT agent_session_id,acp_provider FROM sessions WHERE provider='chat' AND agent_session_id='chat-1';"
  );
  assert.deepEqual(acpRows, [{ agent_session_id: "chat-1", acp_provider: "codex" }]);
});

test("loadAllAgentSessions filters Alma incognito, subagent, and temporary workspace threads by option", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-resume-alma-filter-"));
  const almaHome = path.join(root, "alma");
  await mkdir(almaHome, { recursive: true });
  const almaDb = path.join(almaHome, "chat_threads.db");
  sqlite(
    almaDb,
    `CREATE TABLE workspaces(id TEXT PRIMARY KEY,path TEXT NOT NULL,name TEXT NOT NULL,is_temporary INTEGER NOT NULL DEFAULT 0);
     CREATE TABLE chat_threads(id TEXT PRIMARY KEY,title TEXT NOT NULL,model TEXT,is_incognito INTEGER DEFAULT 0,workspace_id TEXT,parent_thread_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
     CREATE TABLE chat_messages(id TEXT PRIMARY KEY,thread_id TEXT NOT NULL,message TEXT NOT NULL,timestamp TEXT NOT NULL,created_at TEXT NOT NULL);
     INSERT INTO workspaces VALUES('ws-normal','/tmp/alma-normal','normal',0);
     INSERT INTO workspaces VALUES('ws-temp','/tmp/alma-temp','Temp Workspace',1);
     INSERT INTO chat_threads VALUES('a-normal','Normal thread','m1',0,'ws-normal',NULL,'2026-01-01T00:00:01Z','2026-01-01T00:00:05Z');
     INSERT INTO chat_threads VALUES('a-incog','Incognito thread','m1',1,'ws-normal',NULL,'2026-01-01T00:00:01Z','2026-01-01T00:00:04Z');
     INSERT INTO chat_threads VALUES('a-sub','Subagent thread','m1',0,'ws-normal','a-normal','2026-01-01T00:00:01Z','2026-01-01T00:00:03Z');
     INSERT INTO chat_threads VALUES('a-temp','Temp workspace thread','m1',0,'ws-temp',NULL,'2026-01-01T00:00:01Z','2026-01-01T00:00:02Z');`
  );

  const panelHome = path.join(root, "panel");
  const defaults = await loadAllAgentSessions(
    buildSyncOptions({ panelHome, agentHomes: { almaHome } })
  );
  assert.deepEqual(
    defaults.sessions.filter((s) => s.provider === "alma").map((s) => s.id),
    ["a-normal"]
  );

  const withAll = await loadAllAgentSessions(
    buildSyncOptions({
      panelHome,
      agentHomes: { almaHome },
      sessionSync: {
        showIncognitoAlma: true,
        showSubagentAlma: true,
        showTempWorkspaceAlma: true
      }
    })
  );
  assert.deepEqual(
    withAll.sessions.filter((s) => s.provider === "alma").map((s) => s.id),
    ["a-normal", "a-incog", "a-sub", "a-temp"]
  );
});

test("JSONL title and session_info metadata timestamps do not override session body updatedAt", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-resume-jsonl-title-ts-"));
  const piHome = path.join(root, "pi");
  const ompHome = path.join(root, "omp");
  const bodyIso = "2026-01-02T03:04:05.000Z";
  const bodyMs = Date.parse(bodyIso);
  const laterRenameIso = "2026-11-26T18:00:00.000Z";

  await jsonl(path.join(piHome, "sessions", "pi-renamed.jsonl"), [
    { type: "session", id: "pi-renamed", cwd: "/tmp/pi", timestamp: "2026-01-02T03:00:00.000Z" },
    { type: "session_info", name: "Renamed Pi", timestamp: laterRenameIso },
    { type: "message", timestamp: bodyIso, message: { role: "user", content: "Pi body" } }
  ]);
  await jsonl(path.join(ompHome, "sessions", "omp-renamed.jsonl"), [
    { type: "title", v: 1, title: "Renamed OMP", updatedAt: laterRenameIso },
    { type: "session", version: 3, id: "omp-renamed", cwd: "/tmp/omp", timestamp: "2026-01-02T03:00:00.000Z" },
    { type: "message", timestamp: bodyIso, message: { role: "user", content: [{ type: "text", text: "OMP body" }] } }
  ]);

  const result = await loadAllAgentSessions(buildSyncOptions({
    panelHome: path.join(root, "panel"),
    agentHomes: { piHome, ompHome }
  }));

  const piSession = result.sessions.find((s) => s.provider === "pi" && s.id === "pi-renamed");
  const ompSession = result.sessions.find((s) => s.provider === "omp" && s.id === "omp-renamed");
  assert.equal(piSession?.updatedAt, bodyMs);
  assert.equal(piSession?.title, "Renamed Pi");
  assert.equal(ompSession?.updatedAt, bodyMs);
  assert.equal(ompSession?.title, "Renamed OMP");
});
