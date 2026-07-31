import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildNativeConversationArtifacts, runSqlite, runSqliteJson } from "../dist/index.js";

async function write(root, relative, contents = "{}\n") {
  const file = path.join(root, ...relative.split("/"));
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, contents);
  return file;
}

function settings(root) {
  const homes = Object.fromEntries(["codex", "claude", "agy", "grok", "opencode", "pi", "cursor"].map((provider) => [provider, path.join(root, provider)]));
  return {
    homes,
    settings: {
      panelHome: path.join(root, "panel"),
      agentHomes: {
        codexHome: homes.codex, claudeHome: homes.claude, antigravityHome: homes.agy,
        grokHome: homes.grok, opencodeHome: homes.opencode, piHome: homes.pi, cursorHome: homes.cursor
      }
    }
  };
}

async function createOpenCodeFixture(file, options = {}) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await runSqlite(file, `
    CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL);
    CREATE TABLE workspace (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', time_used INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, workspace_id TEXT, parent_id TEXT, title TEXT NOT NULL, share_url TEXT, permission TEXT, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, time_archived INTEGER);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE todo (session_id TEXT NOT NULL, position INTEGER NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL, priority TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, PRIMARY KEY(session_id, position));
    CREATE TABLE session_context_epoch (session_id TEXT PRIMARY KEY, baseline TEXT NOT NULL, snapshot TEXT NOT NULL, baseline_seq INTEGER NOT NULL);
    CREATE TABLE session_input (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, prompt TEXT NOT NULL, delivery TEXT NOT NULL, admitted_seq INTEGER NOT NULL, time_created INTEGER NOT NULL);
    CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL, seq INTEGER NOT NULL);
    CREATE TABLE event_sequence (aggregate_id TEXT PRIMARY KEY, seq INTEGER NOT NULL);
    CREATE TABLE event (id TEXT PRIMARY KEY, aggregate_id TEXT NOT NULL, seq INTEGER NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE account (id TEXT PRIMARY KEY, email TEXT NOT NULL, access_token TEXT NOT NULL);
    CREATE TABLE credential (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE permission (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, action TEXT NOT NULL, resource TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL);
    CREATE TABLE session_share (session_id TEXT PRIMARY KEY, secret TEXT NOT NULL);
    CREATE TABLE migration (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL);
    INSERT INTO project VALUES ('p1', '/project', 1, 2);
    INSERT INTO workspace VALUES ('w1', 'p1', 'git', 'main', 3);
    INSERT INTO session VALUES ('active', 'p1', 'w1', NULL, 'Active', 'https://share', '{"allow":true}', 1, 200, NULL);
    INSERT INTO session VALUES ('child', 'p1', 'w1', 'active', 'Child', 'https://share-child', '{"allow":true}', 2, 201, NULL);
    INSERT INTO session VALUES ('archived', 'p1', 'w1', NULL, 'Archived', 'https://share-old', '{"allow":true}', 3, 100, 99);
    INSERT INTO message VALUES ('m-active', 'active', 1, 2, '${"x".repeat(options.messageBytes || 20)}');
    INSERT INTO message VALUES ('m-child', 'child', 2, 3, 'child message');
    INSERT INTO message VALUES ('m-archived', 'archived', 3, 4, 'archived message');
    INSERT INTO part VALUES ('part-active', 'm-active', 'active', 1, 2, 'part active');
    INSERT INTO part VALUES ('part-archived', 'm-archived', 'archived', 3, 4, 'part archived');
    INSERT INTO todo VALUES ('active', 1, 'keep todo', 'pending', 'high', 1, 2);
    INSERT INTO session_context_epoch VALUES ('active', 'baseline', 'snapshot', 1);
    INSERT INTO session_input VALUES ('input-active', 'active', 'prompt', 'user', 1, 1);
    INSERT INTO session_message VALUES ('sm-active', 'active', 'message', 1, 2, 'state', 1);
    INSERT INTO event_sequence VALUES ('active', 99);
    INSERT INTO event VALUES ('event-active', 'active', 99, 'snapshot', '${"h".repeat(32 * 1024)}');
    INSERT INTO account VALUES ('a1', 'user@example.com', 'secret');
    INSERT INTO credential VALUES ('c1', 'credential');
    INSERT INTO permission VALUES ('perm', 'p1', 'read', '*', 1, 2);
    INSERT INTO session_share VALUES ('active', 'share-secret');
    INSERT INTO migration VALUES ('current', 1);
  `);
}

test("OpenCode artifacts keep only unarchived current state and Grok keeps final chat files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-native-artifact-"));
  try {
    const { homes, settings: panelSettings } = settings(root);
    await createOpenCodeFixture(path.join(homes.opencode, "opencode.db"));
    await write(homes.grok, "sessions/g1/summary.json", '{"title":"final"}');
    await write(homes.grok, "sessions/g1/chat_history.jsonl", '{"role":"user","content":"hello"}\n');
    await write(homes.grok, "sessions/g1/rewind_points.jsonl", "old rewind\n");
    await write(homes.grok, "sessions/g1/updates.jsonl", "old update\n");
    await write(homes.grok, "sessions/g1/events.jsonl", "old event\n");
    await write(homes.grok, "sessions/g1/hunks/0001.json", "old hunk\n");
    await write(homes.grok, "sessions/g1/search-index.json", "old index\n");

    const artifactRoot = path.join(root, "artifact");
    const collection = await buildNativeConversationArtifacts(panelSettings, artifactRoot);
    const found = new Set(collection.files.map((file) => `${file.provider}:${file.relativePath}`));
    assert.deepEqual([...found].filter((item) => item.startsWith("grok:")).sort(), [
      "grok:sessions/g1/chat_history.jsonl", "grok:sessions/g1/summary.json"
    ]);
    assert.equal(found.has("opencode:opencode.db"), true);
    const outputDb = path.join(artifactRoot, "opencode", "opencode.db");
    assert.deepEqual(await runSqliteJson(outputDb, "SELECT id FROM session ORDER BY id;"), [{ id: "active" }, { id: "child" }]);
    assert.deepEqual(await runSqliteJson(outputDb, "SELECT share_url, permission FROM session WHERE id = 'active';"), [{ share_url: null, permission: null }]);
    for (const table of ["event", "event_sequence", "account", "credential", "permission", "session_share"]) {
      assert.deepEqual(await runSqliteJson(outputDb, `SELECT COUNT(*) AS count FROM ${table};`), [{ count: 0 }]);
    }
    assert.deepEqual(await runSqliteJson(outputDb, "SELECT id FROM migration;"), [{ id: "current" }]);
    const opencode = collection.providers.find((provider) => provider.provider === "opencode");
    const grok = collection.providers.find((provider) => provider.provider === "grok");
    assert.equal(opencode?.strategy, "compact-current-v2");
    assert.ok((opencode?.excludedBytes || 0) > 0);
    assert.equal(grok?.strategy, "final-chat-v2");
    assert.ok((grok?.excludedBytes || 0) > 0);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("OpenCode compact artifacts split deterministically under the per-file limit", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-native-shard-"));
  try {
    const { homes, settings: panelSettings } = settings(root);
    await createOpenCodeFixture(path.join(homes.opencode, "opencode.db"), { messageBytes: 600 * 1024 });
    const db = path.join(homes.opencode, "opencode.db");
    await runSqlite(db, `INSERT INTO message VALUES ('m-active-2', 'active', 3, 4, '${"y".repeat(600 * 1024)}'); INSERT INTO message VALUES ('m-active-3', 'active', 5, 6, '${"z".repeat(600 * 1024)}');`);
    const artifactRoot = path.join(root, "artifact");
    const collection = await buildNativeConversationArtifacts(panelSettings, artifactRoot, { maxFileBytes: 1024 * 1024, opencodeShardTargetBytes: 700 * 1024 });
    const files = collection.files.filter((file) => file.provider === "opencode");
    assert.ok(files.length > 1, JSON.stringify({ files: files.map((file) => file.relativePath), warnings: collection.warnings }));
    assert.deepEqual(files.map((file) => file.relativePath), files.map((_file, index) => `shards/${String(index + 1).padStart(4, "0")}.db`));
    assert.ok(files.every((file) => file.size <= 1024 * 1024));
    const sessions = new Set();
    for (const file of files) for (const row of await runSqliteJson(file.absolutePath, "SELECT id FROM session;")) sessions.add(row.id);
    assert.deepEqual([...sessions].sort(), ["active", "child"]);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
