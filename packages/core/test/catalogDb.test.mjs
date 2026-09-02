import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  desktopDbPath,
  ensureDesktopDbSchema,
  ensureExtensionCatalogSchema,
  runSqlite,
  runSqliteJson
} from "../dist/index.js";

test("extension schema does not create desktop-only report tables", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-catalog-"));
  const dbPath = path.join(panelHome, "catalog.db");

  try {
    await ensureExtensionCatalogSchema(dbPath);

    const tables = await runSqliteJson(
      dbPath,
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
    );
    const names = tables.map((row) => row.name);
    assert.ok(names.includes("sessions"));
    assert.ok(names.includes("notes"));
    assert.ok(!names.includes("report_entries"));
    assert.ok(!names.includes("agent_threads"));
    assert.ok(!names.includes("note_vector_index"));
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});

test("desktop schema creates report and agent tables in panelHome/.desktop/desktop.db", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-catalog-"));
  const catalogDb = path.join(panelHome, "catalog.db");
  const desktopDb = desktopDbPath(panelHome);

  try {
    await ensureExtensionCatalogSchema(catalogDb);
    await ensureDesktopDbSchema(desktopDb);

    const catalogTables = await runSqliteJson(
      catalogDb,
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
    );
    const catalogNames = catalogTables.map((row) => row.name);
    assert.ok(catalogNames.includes("sessions"));
    assert.ok(catalogNames.includes("notes"));
    assert.ok(!catalogNames.includes("report_entries"));
    assert.ok(!catalogNames.includes("agent_threads"));

    const desktopTables = await runSqliteJson(
      desktopDb,
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
    );
    const desktopNames = desktopTables.map((row) => row.name);
    assert.ok(desktopNames.includes("report_entries"));
    assert.ok(desktopNames.includes("agent_threads"));
    assert.ok(desktopNames.includes("note_vector_index"));
    assert.ok(desktopNames.includes("session_embeddings"));
    assert.ok(desktopNames.includes("session_transcript_chunks"));
    assert.ok(desktopNames.includes("session_transcript_index"));
    assert.ok(desktopNames.includes("entity_tags"));
    assert.ok(desktopNames.includes("tag_definitions"));
    assert.ok(desktopNames.includes("im_projects"));
    assert.ok(desktopNames.includes("im_role_templates"));
    assert.ok(desktopNames.includes("im_members"));
    assert.ok(desktopNames.includes("im_messages"));
    assert.ok(desktopNames.includes("im_jobs"));
    assert.ok(desktopNames.includes("im_selection_actions"));
    assert.ok(desktopDb.includes(`${path.sep}.desktop${path.sep}desktop.db`));

    const indexes = await runSqliteJson(desktopDb, "PRAGMA index_list(agent_messages);");
    assert.ok(indexes.some((index) => index.name === "idx_agent_messages_thread"));
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});

test("desktop schema adds tools_json to existing im_members tables", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-catalog-"));
  const desktopDb = desktopDbPath(panelHome);

  try {
    await fs.mkdir(path.dirname(desktopDb), { recursive: true });
    await runSqlite(
      desktopDb,
      `CREATE TABLE im_members (
        member_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        template_id TEXT NOT NULL,
        name TEXT NOT NULL,
        persona TEXT NOT NULL DEFAULT '',
        agent TEXT NOT NULL,
        permissions TEXT NOT NULL DEFAULT 'write',
        enabled INTEGER NOT NULL DEFAULT 1,
        acp_chat_id TEXT,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );`
    );

    await ensureDesktopDbSchema(desktopDb);

    const columns = await runSqliteJson(desktopDb, "PRAGMA table_info(im_members);");
    const names = columns.map((column) => column.name);
    assert.ok(names.includes("tools_json"));
    assert.ok(names.includes("model"));
    assert.ok(names.includes("thought_level"));
    assert.ok(names.includes("callable_template_ids_json"));
    assert.ok(names.includes("auto_dispatch"));

    await runSqlite(
      desktopDb,
      `INSERT INTO im_members (
        member_id, project_id, template_id, name, persona, agent, permissions, tools_json, enabled, created_at_ms, updated_at_ms
      ) VALUES (
        'member-1', 'project-1', 'role_developer', 'Developer', '', 'claude', 'write', '{}', 1, 1, 1
      );`
    );
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});
