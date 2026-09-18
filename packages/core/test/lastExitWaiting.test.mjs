import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  clearSessionLastExitWaiting,
  ensureExtensionCatalogSchema,
  listSessions,
  querySessionsPage,
  recordLastExitWaitingSessions,
  runSqlite,
  setSessionLastExitWaiting
} from "../dist/index.js";

async function setupCatalog() {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-last-exit-waiting-"));
  const catalogDb = path.join(panelHome, "catalog.db");
  await ensureExtensionCatalogSchema(catalogDb);
  return { panelHome, catalogDb };
}

async function insertSession(catalogDb, row) {
  await runSqlite(
    catalogDb,
    `INSERT INTO sessions (provider, agent_session_id, title, project_path, updated_at_ms, archived, hidden)
     VALUES (
       '${row.provider || "codex"}',
       '${row.id}',
       '${String(row.title || row.id).replaceAll("'", "''")}',
       '${String(row.projectPath || "/tmp/demo").replaceAll("'", "''")}',
       ${row.updatedAtMs || 100},
       0,
       0
     );`
  );
}

test("setSessionLastExitWaiting updates lastExitWaiting flag on session", async () => {
  const { panelHome, catalogDb } = await setupCatalog();
  try {
    await insertSession(catalogDb, { id: "s1", title: "Session 1" });
    await insertSession(catalogDb, { id: "s2", title: "Session 2" });

    let sessions = await listSessions(catalogDb);
    assert.equal(sessions.find((s) => s.id === "s1")?.lastExitWaiting, undefined);

    await setSessionLastExitWaiting(catalogDb, "codex", "s1", true);
    sessions = await listSessions(catalogDb);
    assert.equal(sessions.find((s) => s.id === "s1")?.lastExitWaiting, true);
    assert.equal(sessions.find((s) => s.id === "s2")?.lastExitWaiting, undefined);

    const page = await querySessionsPage(catalogDb, { limit: 10 });
    assert.equal(page.sessions.find((s) => s.id === "s1")?.lastExitWaiting, true);

    await clearSessionLastExitWaiting(catalogDb, "codex", "s1");
    sessions = await listSessions(catalogDb);
    assert.equal(sessions.find((s) => s.id === "s1")?.lastExitWaiting, undefined);
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});

test("recordLastExitWaitingSessions batch-updates waiting sessions and resets prior ones", async () => {
  const { panelHome, catalogDb } = await setupCatalog();
  try {
    await insertSession(catalogDb, { id: "s1", title: "Session 1" });
    await insertSession(catalogDb, { id: "s2", title: "Session 2" });
    await insertSession(catalogDb, { id: "s3", title: "Session 3" });

    await setSessionLastExitWaiting(catalogDb, "codex", "s1", true);

    // On quit with s2 and s3 awaiting, s1 should be cleared, s2 and s3 set.
    await recordLastExitWaitingSessions(catalogDb, ["codex:s2", "codex:s3"]);

    const sessions = await listSessions(catalogDb);
    assert.equal(sessions.find((s) => s.id === "s1")?.lastExitWaiting, undefined);
    assert.equal(sessions.find((s) => s.id === "s2")?.lastExitWaiting, true);
    assert.equal(sessions.find((s) => s.id === "s3")?.lastExitWaiting, true);
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});
