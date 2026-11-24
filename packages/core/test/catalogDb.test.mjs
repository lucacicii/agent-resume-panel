import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ensureExtensionCatalogSchema,
  runSqliteJson
} from "../dist/index.js";

test("extension schema creates core catalog tables", async () => {
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
    assert.ok(names.includes("projects"));
    assert.ok(names.includes("session_gtd"));
    assert.ok(names.includes("sync_state"));
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});
