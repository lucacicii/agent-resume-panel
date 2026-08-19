import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  updateNativeSessionCwd,
  runSqliteJson
} from "../dist/index.js";

function sqlite(dbPath, sql) {
  execFileSync("sqlite3", [dbPath, sql]);
}

function homes(root) {
  return {
    panelHome: path.join(root, "panel"),
    codexHome: path.join(root, "codex"),
    claudeHome: path.join(root, "claude"),
    antigravityHome: path.join(root, "agy"),
    grokHome: path.join(root, "grok"),
    opencodeHome: path.join(root, "opencode"),
    piHome: path.join(root, "pi"),
    primeHome: path.join(root, "prime"),
    cursorHome: path.join(root, "cursor"),
    cursorIdeUserDataHome: path.join(root, "cursor-ide")
  };
}

test("codex native cwd is rewritten in state sqlite", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "native-cwd-codex-"));
  const h = homes(root);
  await fs.mkdir(h.codexHome, { recursive: true });
  const dbPath = path.join(h.codexHome, "state_1.sqlite");
  sqlite(dbPath, "CREATE TABLE threads(id TEXT,title TEXT,cwd TEXT,updated_at_ms INTEGER,updated_at INTEGER,model TEXT,git_branch TEXT,archived INTEGER,source TEXT,preview TEXT,first_user_message TEXT); INSERT INTO threads VALUES('codex-1','T','/old',1000,NULL,'gpt','main',0,NULL,NULL,NULL);");

  const result = await updateNativeSessionCwd("codex", "codex-1", "/new/project", h);
  assert.equal(result.ok, true);
  const rows = await runSqliteJson(dbPath, "SELECT cwd FROM threads WHERE id='codex-1';");
  assert.equal(rows[0].cwd, "/new/project");

  await fs.rm(root, { recursive: true, force: true });
});

test("codex missing session returns not-found", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "native-cwd-codex-missing-"));
  const h = homes(root);
  await fs.mkdir(h.codexHome, { recursive: true });
  const dbPath = path.join(h.codexHome, "state_1.sqlite");
  sqlite(dbPath, "CREATE TABLE threads(id TEXT,title TEXT,cwd TEXT); INSERT INTO threads VALUES('other','T','/old');");

  const result = await updateNativeSessionCwd("codex", "codex-1", "/new", h);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "not-found");

  await fs.rm(root, { recursive: true, force: true });
});

test("grok native cwd is rewritten in summary.json", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "native-cwd-grok-"));
  const h = homes(root);
  const sessionDir = path.join(h.grokHome, "sessions", "group", "grok-1");
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(path.join(sessionDir, "summary.json"), JSON.stringify({ info: { id: "grok-1", cwd: "/old" }, generated_title: "T" }), "utf8");

  const result = await updateNativeSessionCwd("grok", "grok-1", "/new/project", h);
  assert.equal(result.ok, true);
  const row = JSON.parse(await fs.readFile(path.join(sessionDir, "summary.json"), "utf8"));
  assert.equal(row.info.cwd, "/new/project");

  await fs.rm(root, { recursive: true, force: true });
});

test("opencode native cwd is rewritten in opencode.db", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "native-cwd-opencode-"));
  const h = homes(root);
  await fs.mkdir(h.opencodeHome, { recursive: true });
  const dbPath = path.join(h.opencodeHome, "opencode.db");
  sqlite(dbPath, "CREATE TABLE session(id TEXT,directory TEXT,title TEXT,time_updated INTEGER,time_archived INTEGER,model TEXT); INSERT INTO session VALUES('opencode-1','/old','T',1000,NULL,NULL);");

  const result = await updateNativeSessionCwd("opencode", "opencode-1", "/new/project", h);
  assert.equal(result.ok, true);
  const rows = await runSqliteJson(dbPath, "SELECT directory FROM session WHERE id='opencode-1';");
  assert.equal(rows[0].directory, "/new/project");

  await fs.rm(root, { recursive: true, force: true });
});

test("agy native cwd is rewritten in history.jsonl", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "native-cwd-agy-"));
  const h = homes(root);
  await fs.mkdir(h.antigravityHome, { recursive: true });
  const historyPath = path.join(h.antigravityHome, "history.jsonl");
  await fs.writeFile(historyPath, `${JSON.stringify({ conversationId: "agy-1", display: "T", workspace: "/old", timestamp: 1 })}\n${JSON.stringify({ conversationId: "agy-2", display: "U", workspace: "/other", timestamp: 2 })}\n`, "utf8");

  const result = await updateNativeSessionCwd("agy", "agy-1", "/new/project", h);
  assert.equal(result.ok, true);
  const lines = (await fs.readFile(historyPath, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.find((l) => l.conversationId === "agy-1").workspace, "/new/project");
  assert.equal(lines.find((l) => l.conversationId === "agy-2").workspace, "/other");

  await fs.rm(root, { recursive: true, force: true });
});

test("cursor native cwd is rewritten in meta.json", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "native-cwd-cursor-"));
  const h = homes(root);
  const metaDir = path.join(h.cursorHome, "chats", "workspace-a", "cursor-1");
  await fs.mkdir(metaDir, { recursive: true });
  await fs.writeFile(path.join(metaDir, "meta.json"), JSON.stringify({ schemaVersion: 1, title: "T", cwd: "/old", createdAtMs: 1, updatedAtMs: 2, hasConversation: true }), "utf8");

  const result = await updateNativeSessionCwd("cursor", "cursor-1", "/new/project", h);
  assert.equal(result.ok, true);
  const meta = JSON.parse(await fs.readFile(path.join(metaDir, "meta.json"), "utf8"));
  assert.equal(meta.cwd, "/new/project");

  await fs.rm(root, { recursive: true, force: true });
});

test("claude native cwd is rewritten in project jsonl and history.jsonl", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "native-cwd-claude-"));
  const h = homes(root);
  const projectDir = path.join(h.claudeHome, "projects", "-tmp-old");
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(
    path.join(projectDir, "claude-1.jsonl"),
    `${JSON.stringify({ type: "user", sessionId: "claude-1", cwd: "/tmp/old", timestamp: "2026-01-01T00:00:00Z", message: { content: "hi" } })}\n${JSON.stringify({ type: "assistant", sessionId: "claude-1", cwd: "/tmp/old", timestamp: "2026-01-01T00:00:01Z", message: { content: "yo" } })}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(h.claudeHome, "history.jsonl"),
    `${JSON.stringify({ sessionId: "claude-1", display: "T", project: "/tmp/old", timestamp: 1 })}\n`,
    "utf8"
  );

  const result = await updateNativeSessionCwd("claude", "claude-1", "/new/project", h);
  assert.equal(result.ok, true);
  const rows = (await fs.readFile(path.join(projectDir, "claude-1.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(rows.every((r) => r.cwd === "/new/project"));
  const history = JSON.parse((await fs.readFile(path.join(h.claudeHome, "history.jsonl"), "utf8")).trim());
  assert.equal(history.project, "/new/project");

  await fs.rm(root, { recursive: true, force: true });
});

test("pi and prime native cwd are rewritten on the session header row", async () => {
  for (const provider of ["pi", "prime"]) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), `native-cwd-${provider}-`));
    const h = homes(root);
    const dir = provider === "pi" ? h.piHome : h.primeHome;
    const sessionsDir = path.join(dir, "sessions");
    await fs.mkdir(sessionsDir, { recursive: true });
    const file = path.join(sessionsDir, "sess-1.jsonl");
    await fs.writeFile(
      file,
      `${JSON.stringify({ type: "session", id: "sess-1", cwd: "/old", timestamp: "2026-01-01T00:00:00Z" })}\n${JSON.stringify({ type: "message", timestamp: "2026-01-01T00:00:01Z", message: { role: "user", content: "hi" } })}\n`,
      "utf8"
    );

    const result = await updateNativeSessionCwd(provider, "sess-1", "/new/project", h);
    assert.equal(result.ok, true);
    const header = JSON.parse((await fs.readFile(file, "utf8")).trim().split("\n")[0]);
    assert.equal(header.cwd, "/new/project");

    await fs.rm(root, { recursive: true, force: true });
  }
});

test("unsupported providers fall back without touching anything", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "native-cwd-unsupported-"));
  const h = homes(root);
  for (const provider of ["cursor-ide", "chat"]) {
    const result = await updateNativeSessionCwd(provider, "x-1", "/new", h);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "unsupported-provider");
  }
  await fs.rm(root, { recursive: true, force: true });
});

test("native cwd rewrite converges the next sync onto the target project", async () => {
  const { syncAgentSessions, sessionSyncOptionsFromSettings, moveSessionToProjectInCatalog } = await import("../dist/index.js");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "native-cwd-sync-"));
  const h = homes(root);
  await fs.mkdir(h.codexHome, { recursive: true });
  const dbPath = path.join(h.codexHome, "state_1.sqlite");
  sqlite(dbPath, "CREATE TABLE threads(id TEXT,title TEXT,cwd TEXT,updated_at_ms INTEGER,updated_at INTEGER,model TEXT,git_branch TEXT,archived INTEGER,source TEXT,preview TEXT,first_user_message TEXT); INSERT INTO threads VALUES('codex-1','T','/old',1000,NULL,'gpt','main',0,NULL,NULL,NULL);");

  const settings = {
    panelHome: h.panelHome,
    llm: { baseUrl: "http://localhost", model: "test" },
    embedding: { model: "test" },
    agentHomes: { codexHome: h.codexHome },
    sessionSync: { maxItems: 10000, stalePolicy: "off" }
  };
  const options = sessionSyncOptionsFromSettings(settings);
  await syncAgentSessions(options);

  const moved = await updateNativeSessionCwd("codex", "codex-1", "/new/project", h);
  assert.equal(moved.ok, true);
  await moveSessionToProjectInCatalog(options.dbPath, "codex", "codex-1", "/new/project");
  await syncAgentSessions(options);

  const rows = await runSqliteJson(
    options.dbPath,
    "SELECT project_path, native_project_path FROM sessions WHERE provider='codex' AND agent_session_id='codex-1';"
  );
  assert.equal(rows[0].project_path, "/new/project");
  assert.equal(rows[0].native_project_path, "/new/project");

  await fs.rm(root, { recursive: true, force: true });
});
