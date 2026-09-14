import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ensureExtensionCatalogSchema,
  querySessionsPage,
  runSqlite
} from "../dist/index.js";

async function setupCatalog() {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-query-sessions-"));
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
       ${row.updatedAtMs},
       0,
       ${row.hidden || 0}
     );`
  );
}

async function claimSession(catalogDb, noteId, provider, sessionId) {
  await runSqlite(
    catalogDb,
    `INSERT INTO work_item_sessions (work_item_note_id, provider, agent_session_id, created_at_ms)
     VALUES ('${noteId}', '${provider}', '${sessionId}', 1);`
  );
}

test("unassignedOnly returns only sessions with no work-item claim", async () => {
  const { panelHome, catalogDb } = await setupCatalog();
  try {
    await insertSession(catalogDb, { id: "free-1", title: "Free", updatedAtMs: 30 });
    await insertSession(catalogDb, { id: "owned-1", title: "Owned", updatedAtMs: 20 });
    await insertSession(catalogDb, { id: "owned-2", title: "Owned twice", updatedAtMs: 10 });
    await insertSession(catalogDb, { id: "hidden-free", title: "Hidden", updatedAtMs: 40, hidden: 1 });
    await claimSession(catalogDb, "note-a", "codex", "owned-1");
    await claimSession(catalogDb, "note-a", "codex", "owned-2");
    await claimSession(catalogDb, "note-b", "codex", "owned-2");

    const all = await querySessionsPage(catalogDb, { limit: 50 });
    assert.equal(all.total, 3);
    assert.deepEqual(all.sessions.map((session) => session.id), ["free-1", "owned-1", "owned-2"]);

    const unassigned = await querySessionsPage(catalogDb, { limit: 50, unassignedOnly: true });
    assert.equal(unassigned.total, 1);
    assert.equal(unassigned.sessions.length, 1);
    assert.equal(unassigned.sessions[0].id, "free-1");
    assert.equal(unassigned.nextCursor, undefined);
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});

test("unassignedOnly total matches keyset pages when results span multiple pages", async () => {
  const { panelHome, catalogDb } = await setupCatalog();
  try {
    for (let i = 0; i < 5; i += 1) {
      await insertSession(catalogDb, { id: `free-${i}`, title: `Free ${i}`, updatedAtMs: 100 + i });
    }
    for (let i = 0; i < 3; i += 1) {
      await insertSession(catalogDb, { id: `owned-${i}`, title: `Owned ${i}`, updatedAtMs: 200 + i });
      await claimSession(catalogDb, "note-a", "codex", `owned-${i}`);
    }

    const first = await querySessionsPage(catalogDb, { limit: 2, unassignedOnly: true });
    assert.equal(first.total, 5, "total must use the unassigned filter, not the unfiltered catalog");
    assert.equal(first.sessions.length, 2);
    assert.ok(first.nextCursor);

    const second = await querySessionsPage(catalogDb, {
      limit: 2,
      unassignedOnly: true,
      cursor: first.nextCursor
    });
    assert.equal(second.total, 5);
    assert.equal(second.sessions.length, 2);
    assert.ok(second.nextCursor);

    const third = await querySessionsPage(catalogDb, {
      limit: 2,
      unassignedOnly: true,
      cursor: second.nextCursor
    });
    assert.equal(third.total, 5);
    assert.equal(third.sessions.length, 1);
    assert.equal(third.nextCursor, undefined);

    const seen = [...first.sessions, ...second.sessions, ...third.sessions].map((session) => session.id);
    assert.deepEqual(seen.sort(), ["free-0", "free-1", "free-2", "free-3", "free-4"]);
    assert.equal(seen.length, first.total);
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});
