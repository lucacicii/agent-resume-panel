import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureCatalogSchema, runSqlite, runSqliteJson } from "../dist/index.js";

test("migrates legacy ask_messages before creating the thread index", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-catalog-"));
  const dbPath = path.join(panelHome, "catalog.db");

  try {
    await runSqlite(
      dbPath,
      `CREATE TABLE ask_messages (
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

    const columns = await runSqliteJson(dbPath, "PRAGMA table_info(ask_messages);");
    assert.ok(columns.some((column) => column.name === "thread_id"));

    const indexes = await runSqliteJson(dbPath, "PRAGMA index_list(ask_messages);");
    assert.ok(indexes.some((index) => index.name === "idx_ask_messages_thread"));
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});
