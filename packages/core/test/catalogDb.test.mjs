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
    assert.ok(desktopDb.includes(`${path.sep}.desktop${path.sep}desktop.db`));

    const indexes = await runSqliteJson(desktopDb, "PRAGMA index_list(agent_messages);");
    assert.ok(indexes.some((index) => index.name === "idx_agent_messages_thread"));
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});

test("desktop schema upgrades legacy Flow tables before creating sourced Flow indexes", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-flow-schema-"));
  const desktopDb = desktopDbPath(panelHome);
  try {
    await fs.mkdir(path.dirname(desktopDb), { recursive: true });
    await runSqlite(desktopDb, `
      CREATE TABLE flow_workflows (
        flow_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        project_path TEXT NOT NULL,
        name TEXT NOT NULL,
        root_note_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle',
        revision INTEGER NOT NULL DEFAULT 1,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );
      CREATE TABLE flow_nodes (
        node_id TEXT PRIMARY KEY,
        flow_id TEXT NOT NULL,
        note_id TEXT NOT NULL,
        title TEXT NOT NULL,
        provider TEXT NOT NULL,
        binding_mode TEXT NOT NULL DEFAULT 'new-yolo',
        session_provider TEXT,
        session_id TEXT,
        status TEXT NOT NULL DEFAULT 'idle',
        position_x REAL NOT NULL DEFAULT 0,
        position_y REAL NOT NULL DEFAULT 0,
        priority INTEGER NOT NULL DEFAULT 0,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );
    `);

    await ensureDesktopDbSchema(desktopDb);

    const workflowColumns = await runSqliteJson(desktopDb, "PRAGMA table_info(flow_workflows);");
    const nodeColumns = await runSqliteJson(desktopDb, "PRAGMA table_info(flow_nodes);");
    assert.ok(workflowColumns.some((column) => column.name === "source_kind"));
    assert.ok(workflowColumns.some((column) => column.name === "source_key"));
    assert.ok(nodeColumns.some((column) => column.name === "external_key"));

    const workflowIndexes = await runSqliteJson(desktopDb, "PRAGMA index_list(flow_workflows);");
    const nodeIndexes = await runSqliteJson(desktopDb, "PRAGMA index_list(flow_nodes);");
    assert.ok(workflowIndexes.some((index) => index.name === "idx_flow_workflows_source"));
    assert.ok(nodeIndexes.some((index) => index.name === "idx_flow_nodes_external"));
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});
