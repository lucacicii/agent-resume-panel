#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);

const { ensureCatalogSchema } = require("../out/catalog/db.js");
const {
  setSessionGtdStatus,
  loadSessionGtdMap,
  querySessionsByGtdStatus
} = require("../out/catalog/gtd.js");
const { runSqlite, runSqliteJson } = require("../out/history/sqlite.js");

const tempDir = await mkdtemp(join(tmpdir(), "agent-resume-panel-concurrent-"));
const dbPath = join(tempDir, "catalog.db");

try {
  // Test 1: Multiple concurrent ensureCatalogSchema calls on a fresh database
  await Promise.all([
    ensureCatalogSchema(dbPath),
    ensureCatalogSchema(dbPath),
    ensureCatalogSchema(dbPath),
    ensureCatalogSchema(dbPath),
    ensureCatalogSchema(dbPath)
  ]);

  // Verify index was created
  const indexes = await runSqliteJson(
    dbPath,
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_session_gtd_status';"
  );
  assert.equal(indexes.length, 1, "idx_session_gtd_status index should exist");

  // Insert seed sessions
  await runSqlite(
    dbPath,
    `INSERT INTO sessions (
      provider, agent_session_id, title, project_path, updated_at_ms, archived, hidden
    ) VALUES
      ('codex', 'sess-1', 'Session 1', '/tmp/p1', 1000, 0, 0),
      ('claude', 'sess-2', 'Session 2', '/tmp/p2', 2000, 0, 0),
      ('agy', 'sess-3', 'Session 3', '/tmp/p3', 3000, 0, 0),
      ('grok', 'sess-4', 'Session 4', '/tmp/p4', 4000, 0, 0),
      ('opencode', 'sess-5', 'Session 5', '/tmp/p5', 5000, 0, 0);`
  );

  // Test 2: Multiple concurrent writes, reads, and ensureCatalogSchema calls
  await Promise.all([
    setSessionGtdStatus(dbPath, { provider: "codex", id: "sess-1" }, "inbox"),
    setSessionGtdStatus(dbPath, { provider: "claude", id: "sess-2" }, "next"),
    setSessionGtdStatus(dbPath, { provider: "agy", id: "sess-3" }, "waiting"),
    setSessionGtdStatus(dbPath, { provider: "grok", id: "sess-4" }, "someday"),
    setSessionGtdStatus(dbPath, { provider: "opencode", id: "sess-5" }, "done"),
    ensureCatalogSchema(dbPath),
    loadSessionGtdMap(dbPath),
    querySessionsByGtdStatus(dbPath, "next")
  ]);

  const map = await loadSessionGtdMap(dbPath);
  assert.equal(map["codex:sess-1"], "inbox");
  assert.equal(map["claude:sess-2"], "next");
  assert.equal(map["agy:sess-3"], "waiting");
  assert.equal(map["grok:sess-4"], "someday");
  assert.equal(map["opencode:sess-5"], "done");

  const doneSessions = await querySessionsByGtdStatus(dbPath, "done");
  assert.equal(doneSessions.length, 1);
  assert.equal(doneSessions[0].id, "sess-5");

  console.log("concurrent-catalog-schema.test.mjs: all assertions passed");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
