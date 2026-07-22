import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  clearSessionGtdStatus,
  ensureExtensionCatalogSchema,
  loadSessionGtdMap,
  setSessionGtdStatus
} from "../dist/index.js";

test("session GTD status map supports set and clear", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-gtd-store-"));
  const catalogDb = path.join(panelHome, "catalog.db");
  try {
    await ensureExtensionCatalogSchema(catalogDb);
    await setSessionGtdStatus(catalogDb, "codex", "session-1", "next");
    await setSessionGtdStatus(catalogDb, "claude", "session-2", "waiting");

    assert.deepEqual(await loadSessionGtdMap(catalogDb), {
      "codex:session-1": "next",
      "claude:session-2": "waiting"
    });

    await clearSessionGtdStatus(catalogDb, "codex", "session-1");
    assert.deepEqual(await loadSessionGtdMap(catalogDb), {
      "claude:session-2": "waiting"
    });
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});
