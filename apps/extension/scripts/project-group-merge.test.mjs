#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);

const { ensureCatalogSchema } = require("../out/catalog/db.js");
const { queryProjectGroupSummaries, queryProjectSessionsPage } = require("../out/catalog/query.js");
const { runSqlite } = require("../out/history/sqlite.js");

const tempDir = await mkdtemp(join(tmpdir(), "agent-resume-panel-groups-"));
const dbPath = join(tempDir, "catalog.db");

try {
  await ensureCatalogSchema(dbPath);

  // Same folder, two project_id values (one NULL): must collapse into one project node, otherwise
  // the tree registers two items with id agentResume.project:<path>.
  await runSqlite(
    dbPath,
    `INSERT INTO sessions (
      provider, agent_session_id, title, project_path, updated_at_ms, archived, hidden, project_id
    ) VALUES
      ('codex', 'a1', 'a1', '/tmp/mixed', 1000, 0, 0, 'proj-1'),
      ('codex', 'a2', 'a2', '/tmp/mixed', 2000, 0, 0, 'proj-1'),
      ('claude', 'b1', 'b1', '/tmp/mixed', 3000, 0, 0, NULL),
      ('codex', 'c1', 'c1', '/tmp/other', 4000, 0, 0, 'proj-2');`
  );

  const groups = await queryProjectGroupSummaries(dbPath, []);
  const mixed = groups.filter((group) => group.projectPath === "/tmp/mixed");
  assert.equal(mixed.length, 1, "one group per folder");
  assert.equal(mixed[0].sessionCount, 3, "session counts merged");
  assert.equal(groups.filter((group) => group.projectPath === "/tmp/other").length, 1);

  const byPath = new Set(groups.map((group) => group.projectPath));
  assert.equal(byPath.size, groups.length, "display paths are unique");

  const sessions = await queryProjectSessionsPage(dbPath, {
    projectPath: mixed[0].projectPath,
    projectId: mixed[0].projectId,
    candidatePaths: mixed[0].candidatePaths,
    limit: 50
  });
  assert.equal(sessions.total, 3, "merged node lists sessions of every merged group");

  console.log("project-group-merge.test.mjs: all assertions passed");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
