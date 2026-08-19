import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ensureExtensionCatalogSchema,
  getCatalogMeta,
  getNoteByRelPath,
  listAllNotes,
  migrateLegacyNotesToDisk,
  reconcileNotesIndex,
  runSqlite,
  upsertNoteRecord
} from "../dist/index.js";

async function withTempPanel(run) {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-notes-"));
  const dbPath = path.join(panelHome, "catalog.db");
  try {
    await ensureExtensionCatalogSchema(dbPath);
    await run(panelHome, dbPath);
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
}

test("upsertNoteRecord keeps path owner when note_id differs (no UNIQUE crash)", async () => {
  await withTempPanel(async (_panelHome, dbPath) => {
    const relMdPath = path.join("notes", "library", "note.md");
    await upsertNoteRecord(dbPath, {
      noteId: "note-a",
      scope: "library",
      filename: "note.md",
      relDir: "library",
      relMdPath,
      title: "Original",
      contentPreview: "body a",
      createdAtMs: 100,
      updatedAtMs: 100,
      fsMtimeMs: 100
    });

    await upsertNoteRecord(dbPath, {
      noteId: "note-b",
      scope: "library",
      filename: "note.md",
      relDir: "library",
      relMdPath,
      title: "Updated",
      contentPreview: "body b",
      createdAtMs: 200,
      updatedAtMs: 200,
      fsMtimeMs: 200
    });

    const all = await listAllNotes(dbPath);
    assert.equal(all.length, 1);
    assert.equal(all[0].noteId, "note-a");
    assert.equal(all[0].title, "Updated");
    assert.equal(all[0].relMdPath, relMdPath);
    assert.equal(all[0].createdAtMs, 100);
  });
});

test("upsertNoteRecord same note_id still updates fields", async () => {
  await withTempPanel(async (_panelHome, dbPath) => {
    const relMdPath = path.join("notes", "library", "same.md");
    await upsertNoteRecord(dbPath, {
      noteId: "same-id",
      scope: "library",
      filename: "same.md",
      relDir: "library",
      relMdPath,
      title: "Before",
      contentPreview: "before",
      createdAtMs: 10,
      updatedAtMs: 10,
      fsMtimeMs: 10
    });
    await upsertNoteRecord(dbPath, {
      noteId: "same-id",
      scope: "library",
      filename: "same.md",
      relDir: "library",
      relMdPath,
      title: "After",
      contentPreview: "after",
      createdAtMs: 10,
      updatedAtMs: 50,
      fsMtimeMs: 50
    });
    const row = await getNoteByRelPath(dbPath, relMdPath);
    assert.equal(row?.noteId, "same-id");
    assert.equal(row?.title, "After");
    assert.equal(row?.updatedAtMs, 50);
  });
});

test("reconcileNotesIndex prefers path DB id over mismatched frontmatter id", async () => {
  await withTempPanel(async (panelHome, dbPath) => {
    const relDir = "library";
    const filename = "conflict.md";
    const relMdPath = path.join("notes", relDir, filename);
    const ownerDir = path.join(panelHome, "notes", relDir);
    await fs.mkdir(ownerDir, { recursive: true });
    await fs.writeFile(
      path.join(ownerDir, filename),
      ["---", "id: frontmatter-id", "scope: library", "createdAt: 2026-01-01T00:00:00.000Z", "---", "", "# From disk", ""].join(
        "\n"
      ),
      "utf8"
    );
    const stat = await fs.stat(path.join(ownerDir, filename));

    await upsertNoteRecord(dbPath, {
      noteId: "db-path-id",
      scope: "library",
      filename,
      relDir,
      relMdPath,
      title: "Stale",
      contentPreview: "stale",
      createdAtMs: 1,
      updatedAtMs: 1,
      fsMtimeMs: 1
    });

    await reconcileNotesIndex(dbPath, panelHome);

    const all = await listAllNotes(dbPath);
    assert.equal(all.length, 1);
    assert.equal(all[0].noteId, "db-path-id");
    assert.equal(all[0].title, "From disk");
    assert.ok((all[0].fsMtimeMs ?? 0) >= stat.mtimeMs - 1);
  });
});

test("migrateLegacyNotesToDisk is idempotent when path already indexed", async () => {
  await withTempPanel(async (panelHome, dbPath) => {
    await runSqlite(
      dbPath,
      `INSERT INTO session_notes (provider, agent_session_id, content, updated_at_ms)
       VALUES ('claude', 'sess-1', 'Legacy body', 1700000000000);`
    );

    await migrateLegacyNotesToDisk(dbPath, panelHome);
    const afterFirst = await listAllNotes(dbPath);
    assert.ok(afterFirst.length >= 1);
    const firstId = afterFirst[0].noteId;
    const firstPath = afterFirst[0].relMdPath;

    // Clear migration flag to force re-entry (simulates crash before flag was set previously).
    await runSqlite(dbPath, `DELETE FROM catalog_meta WHERE key = 'notes_disk_migrated_v1';`);

    await migrateLegacyNotesToDisk(dbPath, panelHome);
    const afterSecond = await listAllNotes(dbPath);
    const samePath = afterSecond.filter((n) => n.relMdPath === firstPath);
    assert.equal(samePath.length, 1);
    assert.equal(samePath[0].noteId, firstId);

    const flag = await getCatalogMeta(dbPath, "notes_disk_migrated_v1");
    assert.equal(flag, "1");
  });
});
