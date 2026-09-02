import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildAcpTranscriptRefs,
  deleteAcpSessionFromCatalog,
  syncAcpRecordsIntoCatalog,
  upsertAcpSessionInCatalog
} from "../dist/catalog/acpCatalog.js";
import { ensureExtensionCatalogSchema } from "../dist/catalog/db.js";
import { getSessionById, listSessions } from "../dist/catalog/query.js";

test("upsertAcpSessionInCatalog writes chat row with acp_provider and transcript refs", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "acp-catalog-"));
  const dbPath = path.join(dir, "catalog.db");
  await ensureExtensionCatalogSchema(dbPath);

  await upsertAcpSessionInCatalog(dbPath, dir, {
    id: "chat-1",
    title: "Hello ACP",
    projectPath: "/tmp/project",
    acpProvider: "grok",
    updatedAt: 1_700_000_000_000,
    messageCount: 3,
    model: "grok"
  });

  const session = await getSessionById(dbPath, "chat", "chat-1");
  assert.ok(session);
  assert.equal(session.provider, "chat");
  assert.equal(session.title, "Hello ACP");
  assert.equal(session.projectPath, "/tmp/project");
  assert.equal(session.acpProvider, "grok");
  assert.equal(session.source, "acp");
  assert.equal(session.messageCount, 3);

  const refs = buildAcpTranscriptRefs(dir, "chat-1");
  assert.match(refs, /"kind":"acp"/);
  assert.match(refs, /threads/);

  await deleteAcpSessionFromCatalog(dbPath, "chat-1");
  const gone = await getSessionById(dbPath, "chat", "chat-1");
  assert.equal(gone, undefined);

  await fs.rm(dir, { recursive: true, force: true });
});

test("upsertAcpSessionInCatalog writes custom source e.g. im", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "acp-catalog-im-"));
  const dbPath = path.join(dir, "catalog.db");
  await ensureExtensionCatalogSchema(dbPath);

  await upsertAcpSessionInCatalog(dbPath, dir, {
    id: "chat-im-1",
    title: "IM Dispatched Task",
    projectPath: "/tmp/project",
    acpProvider: "claude",
    updatedAt: 1_700_000_000_000,
    messageCount: 1,
    source: "im"
  });

  const session = await getSessionById(dbPath, "chat", "chat-im-1");
  assert.ok(session);
  assert.equal(session.provider, "chat");
  assert.equal(session.title, "IM Dispatched Task");
  assert.equal(session.source, "im");

  await fs.rm(dir, { recursive: true, force: true });
});

test("syncAcpRecordsIntoCatalog is idempotent and preserves user_title", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "acp-catalog-sync-"));
  const dbPath = path.join(dir, "catalog.db");
  await ensureExtensionCatalogSchema(dbPath);

  const records = [
    {
      id: "a",
      title: "A",
      projectPath: "/p",
      acpProvider: "claude",
      updatedAt: 100,
      messageCount: 1
    }
  ];
  await syncAcpRecordsIntoCatalog(dbPath, dir, records, 200);
  // Simulate user rename via user_title
  const { runSqlite } = await import("../dist/sqlite.js");
  await runSqlite(
    dbPath,
    `UPDATE sessions SET user_title = 'Renamed' WHERE provider = 'chat' AND agent_session_id = 'a';`
  );

  await syncAcpRecordsIntoCatalog(
    dbPath,
    dir,
    [{ ...records[0], title: "A2", messageCount: 5, updatedAt: 300 }],
    400
  );

  const listed = await listSessions(dbPath, 10);
  const row = listed.find((s) => s.id === "a");
  assert.ok(row);
  assert.equal(row.title, "Renamed"); // user_title wins in toAgentSession
  assert.equal(row.messageCount, 5);
  assert.equal(row.acpProvider, "claude");

  await fs.rm(dir, { recursive: true, force: true });
});

test("upsertAcpSessionInCatalog keeps a user-moved project_path", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "acp-catalog-override-"));
  const dbPath = path.join(dir, "catalog.db");
  await ensureExtensionCatalogSchema(dbPath);

  await upsertAcpSessionInCatalog(dbPath, dir, {
    id: "chat-move",
    title: "Move me",
    projectPath: "/tmp/original",
    acpProvider: "claude",
    updatedAt: 100,
    messageCount: 1
  });
  const { runSqliteJson } = await import("../dist/sqlite.js");
  const { moveSessionToProjectInCatalog } = await import("../dist/index.js");
  const moved = await moveSessionToProjectInCatalog(dbPath, "chat", "chat-move", "/tmp/reassigned");
  assert.equal(moved.newPath, "/tmp/reassigned");

  await upsertAcpSessionInCatalog(dbPath, dir, {
    id: "chat-move",
    title: "Move me",
    projectPath: "/tmp/original",
    acpProvider: "claude",
    updatedAt: 200,
    messageCount: 2
  });

  const session = await getSessionById(dbPath, "chat", "chat-move");
  assert.equal(session?.projectPath, "/tmp/reassigned");
  assert.equal(session?.nativeProjectPath, "/tmp/original");
  assert.equal(session?.projectOverridden, true);
  const rows = await runSqliteJson(
    dbPath,
    "SELECT project_path, native_project_path FROM sessions WHERE provider='chat' AND agent_session_id='chat-move';"
  );
  assert.equal(rows[0].project_path, "/tmp/reassigned");
  assert.equal(rows[0].native_project_path, "/tmp/original");

  await fs.rm(dir, { recursive: true, force: true });
});

test("listSessions without a limit returns every visible catalog session", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "acp-catalog-unbounded-"));
  const dbPath = path.join(dir, "catalog.db");
  await ensureExtensionCatalogSchema(dbPath);

  const records = Array.from({ length: 550 }, (_, index) => ({
    id: `chat-${index}`,
    title: `Chat ${index}`,
    projectPath: "/p",
    acpProvider: "codex",
    updatedAt: index + 1,
    messageCount: 1
  }));
  await syncAcpRecordsIntoCatalog(dbPath, dir, records, 1_000);

  assert.equal((await listSessions(dbPath)).length, 550);
  assert.equal((await listSessions(dbPath, 500)).length, 500);

  await fs.rm(dir, { recursive: true, force: true });
});
