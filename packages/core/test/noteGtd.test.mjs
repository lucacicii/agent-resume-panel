import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  clearNoteGtdStatus,
  getNoteGtdStatus,
  NotesStore,
  setNoteGtdStatus
} from "../dist/index.js";

test("note GTD status is catalog metadata and never rewrites Markdown", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-note-gtd-"));
  const catalogDb = path.join(panelHome, "catalog.db");
  const store = new NotesStore(catalogDb, panelHome);
  await store.initialize();

  try {
    const record = await store.createLibraryNote(
      "# Plan\n\n:::gtd next\nLegacy directive\n:::\n\nKeep this paragraph.\n"
    );
    const before = await store.readNoteContent(record.noteId);

    await setNoteGtdStatus(catalogDb, record.noteId, "next");
    assert.equal(await getNoteGtdStatus(catalogDb, record.noteId), "next");
    assert.equal((await store.getNote(record.noteId)).gtdStatus, "next");
    assert.equal(await store.readNoteContent(record.noteId), before);

    await store.writeNoteContent(record.noteId, `${before}\nEdited without touching status.\n`);
    assert.equal((await store.getNote(record.noteId)).gtdStatus, "next");

    const renamed = await store.renameNote(record.noteId, "renamed.md");
    assert.equal(renamed.gtdStatus, "next");
    const moved = await store.moveNote(record.noteId, { scope: "project", projectPath: path.join(panelHome, "project") });
    assert.equal(moved.gtdStatus, "next");
    assert.equal(await getNoteGtdStatus(catalogDb, record.noteId), "next");
    assert.match(await store.readNoteContent(record.noteId), /:::gtd next\nLegacy directive\n:::/);

    await clearNoteGtdStatus(catalogDb, record.noteId);
    assert.equal(await getNoteGtdStatus(catalogDb, record.noteId), undefined);
    assert.equal((await store.getNote(record.noteId)).gtdStatus, undefined);
    assert.match(await store.readNoteContent(record.noteId), /:::gtd next\nLegacy directive\n:::/);
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});
