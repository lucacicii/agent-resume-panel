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
  clearSessionGtdStatus,
  getSessionGtdStatus,
  loadSessionGtdMap,
  querySessionsByGtdStatus
} = require("../out/catalog/gtd.js");
const { runSqlite } = require("../out/history/sqlite.js");

const tempDir = await mkdtemp(join(tmpdir(), "agent-resume-panel-gtd-"));
const dbPath = join(tempDir, "catalog.db");

try {
  await ensureCatalogSchema(dbPath);
  await runSqlite(
    dbPath,
    `INSERT INTO sessions (
      provider, agent_session_id, title, project_path, updated_at_ms, archived, hidden
    ) VALUES (
      'codex', 'sess-1', 'Test Session', '/tmp/project', 1000, 0, 0
    );`
  );

  await setSessionGtdStatus(dbPath, { provider: "codex", id: "sess-1" }, "next");
  assert.equal(await getSessionGtdStatus(dbPath, "codex", "sess-1"), "next");

  const map = await loadSessionGtdMap(dbPath);
  assert.equal(map["codex:sess-1"], "next");

  await setSessionGtdStatus(dbPath, { provider: "codex", id: "sess-1" }, "waiting");
  assert.equal(await getSessionGtdStatus(dbPath, "codex", "sess-1"), "waiting");

  const sessions = await querySessionsByGtdStatus(dbPath, "waiting");
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, "sess-1");

  await clearSessionGtdStatus(dbPath, { provider: "codex", id: "sess-1" });
  assert.equal(await getSessionGtdStatus(dbPath, "codex", "sess-1"), undefined);

  console.log("session-gtd-catalog.test.mjs: all assertions passed");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}