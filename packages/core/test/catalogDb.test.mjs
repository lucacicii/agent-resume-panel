import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureCatalogSchema, runSqlite, runSqliteJson } from "../dist/index.js";

test("migrates legacy agent_messages before creating the thread index", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-catalog-"));
  const dbPath = path.join(panelHome, "catalog.db");

  try {
    await runSqlite(
      dbPath,
      `CREATE TABLE agent_messages (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        citations_json TEXT,
        fallback INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL,
        created_at_ms INTEGER NOT NULL
      );`
    );

    await ensureCatalogSchema(dbPath);

    const columns = await runSqliteJson(dbPath, "PRAGMA table_info(agent_messages);");
    assert.ok(columns.some((column) => column.name === "thread_id"));

    const indexes = await runSqliteJson(dbPath, "PRAGMA index_list(agent_messages);");
    assert.ok(indexes.some((index) => index.name === "idx_agent_messages_thread"));
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});

test("merges legacy ask chat rows when empty agent tables already exist", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-catalog-"));
  const dbPath = path.join(panelHome, "catalog.db");

  try {
    await runSqlite(
      dbPath,
      `CREATE TABLE ask_threads (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );
      INSERT INTO ask_threads VALUES ('legacy-1', 'Old chat', 1000, 2000);
      CREATE TABLE agent_threads (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );
      INSERT INTO agent_threads VALUES ('new-1', 'New chat', 3000, 4000);
      CREATE TABLE ask_messages (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        citations_json TEXT,
        fallback INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL,
        created_at_ms INTEGER NOT NULL,
        thread_id TEXT
      );
      INSERT INTO ask_messages VALUES ('m1', 'user', 'hello', NULL, 0, 1, 1000, 'legacy-1');
      CREATE TABLE agent_messages (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        citations_json TEXT,
        fallback INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL,
        created_at_ms INTEGER NOT NULL,
        thread_id TEXT
      );`
    );

    await ensureCatalogSchema(dbPath);

    const threadCount = await runSqliteJson(dbPath, "SELECT COUNT(*) AS c FROM agent_threads;");
    assert.equal(Number(threadCount[0]?.c), 2);
    const messageCount = await runSqliteJson(dbPath, "SELECT COUNT(*) AS c FROM agent_messages;");
    assert.equal(Number(messageCount[0]?.c), 1);
    const tables = await runSqliteJson(
      dbPath,
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('ask_threads', 'ask_messages');"
    );
    assert.equal(tables.length, 0);
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});

test("renames legacy memory_entries and ask_threads tables", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-catalog-"));
  const dbPath = path.join(panelHome, "catalog.db");

  try {
    await runSqlite(
      dbPath,
      `CREATE TABLE memory_entries (
        id TEXT PRIMARY KEY,
        level TEXT NOT NULL,
        period_start_ms INTEGER NOT NULL,
        period_end_ms INTEGER NOT NULL,
        title TEXT,
        content TEXT NOT NULL,
        embedding_json TEXT,
        created_at_ms INTEGER NOT NULL
      );
      CREATE TABLE ask_threads (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );`
    );

    await ensureCatalogSchema(dbPath);

    const tables = await runSqliteJson(
      dbPath,
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
    );
    const names = tables.map((row) => row.name);
    assert.ok(names.includes("report_entries"));
    assert.ok(names.includes("agent_threads"));
    assert.ok(!names.includes("memory_entries"));
    assert.ok(!names.includes("ask_threads"));
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});