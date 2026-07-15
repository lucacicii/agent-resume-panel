import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  desktopDbPath,
  ensureDesktopDbSchema,
  ensureExtensionCatalogSchema,
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
    assert.ok(desktopDb.includes(`${path.sep}.desktop${path.sep}desktop.db`));

    const indexes = await runSqliteJson(desktopDb, "PRAGMA index_list(agent_messages);");
    assert.ok(indexes.some((index) => index.name === "idx_agent_messages_thread"));
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});