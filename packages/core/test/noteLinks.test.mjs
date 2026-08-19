import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  NotesStore,
  collectDescendantIds,
  ensureExtensionCatalogSchema,
  getNoteSubtree,
  listAllNoteLinks,
  setParentLink,
  wouldCreateCycle
} from "../dist/index.js";

async function withStore(run) {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-links-"));
  const dbPath = path.join(panelHome, "catalog.db");
  try {
    await ensureExtensionCatalogSchema(dbPath);
    const store = new NotesStore(dbPath, panelHome);
    await store.initialize();
    await run(store, panelHome, dbPath);
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
}

test("setParent builds tree; cycle rejected; reparent works", async () => {
  await withStore(async (store) => {
    const a = await store.createProjectNote("/tmp/proj-a", "# A\n");
    const b = await store.createProjectNote("/tmp/proj-a", "# B\n");
    const c = await store.createProjectNote("/tmp/proj-b", "# C\n");

    await store.setNoteParent(b.noteId, a.noteId);
    await store.setNoteParent(c.noteId, a.noteId);

    const children = await store.listNoteChildren(a.noteId);
    assert.equal(children.length, 2);

    await assert.rejects(() => store.setNoteParent(a.noteId, b.noteId), /cycle/i);

    // Cross-project reparent: move c under b
    await store.setNoteParent(c.noteId, b.noteId);
    const parentOfC = await store.getNoteParent(c.noteId);
    assert.equal(parentOfC?.parentNoteId, b.noteId);

    const subtree = await store.getNoteSubtree(a.noteId);
    assert.equal(subtree.root.noteId, a.noteId);
    assert.equal(subtree.root.children.length, 1);
    assert.equal(subtree.root.children[0].noteId, b.noteId);
    assert.equal(subtree.root.children[0].children[0].noteId, c.noteId);
  });
});

test("listRootNotes hides linked children; clear parent restores", async () => {
  await withStore(async (store) => {
    const root = await store.createProjectNote("/tmp/proj-r", "# Root\n");
    const child = await store.createLinkedChildNote(root.noteId, "# Child\n");
    const library = await store.createLibraryNote("# Lib\n");

    const roots = await store.listRootNotes();
    const ids = new Set(roots.map((n) => n.noteId));
    assert.ok(ids.has(root.noteId));
    assert.ok(ids.has(library.noteId));
    assert.ok(!ids.has(child.noteId));

    await store.clearNoteParent(child.noteId);
    const roots2 = await store.listRootNotes();
    assert.ok(roots2.some((n) => n.noteId === child.noteId));
  });
});

test("deleteNote removes incident links without cascading children", async () => {
  await withStore(async (store, _home, dbPath) => {
    const a = await store.createProjectNote("/tmp/proj-d", "# A\n");
    const b = await store.createLinkedChildNote(a.noteId, "# B\n");
    const c = await store.createLinkedChildNote(b.noteId, "# C\n");

    await store.deleteNote(b.noteId);
    const links = await listAllNoteLinks(dbPath);
    assert.equal(links.length, 0);

    const remaining = store.getAllNotes().map((n) => n.noteId);
    assert.ok(remaining.includes(a.noteId));
    assert.ok(remaining.includes(c.noteId));
    assert.ok(!remaining.includes(b.noteId));

    // C is now a root
    const roots = await store.listRootNotes();
    assert.ok(roots.some((n) => n.noteId === c.noteId));
  });
});

test("non-project notes cannot be linked", async () => {
  await withStore(async (store) => {
    const lib = await store.createLibraryNote("# L\n");
    const proj = await store.createProjectNote("/tmp/p", "# P\n");
    await assert.rejects(() => store.setNoteParent(lib.noteId, proj.noteId), /project note/i);
    await assert.rejects(() => store.setNoteParent(proj.noteId, lib.noteId), /project note/i);
  });
});

test("wouldCreateCycle and collectDescendantIds helpers", async () => {
  await withStore(async (store, _home, dbPath) => {
    const a = await store.createProjectNote("/tmp/x", "# A\n");
    const b = await store.createLinkedChildNote(a.noteId, "# B\n");
    const c = await store.createLinkedChildNote(b.noteId, "# C\n");

    assert.equal(await wouldCreateCycle(dbPath, c.noteId, a.noteId), false);
    assert.equal(await wouldCreateCycle(dbPath, a.noteId, c.noteId), true);
    assert.equal(await wouldCreateCycle(dbPath, a.noteId, a.noteId), true);

    const desc = await collectDescendantIds(dbPath, a.noteId);
    assert.ok(desc.has(b.noteId));
    assert.ok(desc.has(c.noteId));

    const tree = await getNoteSubtree(dbPath, a.noteId);
    assert.equal(Object.keys(tree.nodesById).length, 3);
  });
});
