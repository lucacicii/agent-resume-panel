import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_WORK_ITEM_TITLE_SUFFIX,
  NotesStore,
  WORK_ITEM_KNOWLEDGE_BEGIN,
  WORK_ITEM_KNOWLEDGE_END,
  ensureExtensionCatalogSchema,
  listAllNotes,
  runSqlite,
  workItemPromptBody
} from "../dist/index.js";

async function withStore(run) {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-work-note-"));
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

async function readWorkItemFile(store, noteId) {
  const record = await store.getNote(noteId);
  return fs.readFile(store.absolutePath(record), "utf8");
}

test("new work items carry a front-matter name, a reminder heading and a knowledge region", async () => {
  await withStore(async (store, _home, dbPath) => {
    const item = await store.createWorkItem({ title: "Ship release" });
    assert.equal(item.title, "Ship release");

    const raw = await readWorkItemFile(store, item.noteId);
    assert.match(raw, /title: "?Ship release"?/);
    assert.match(raw, new RegExp(`# Ship release${escapeRegExp(DEFAULT_WORK_ITEM_TITLE_SUFFIX)}`));
    assert.ok(raw.includes(WORK_ITEM_KNOWLEDGE_BEGIN));
    assert.ok(raw.includes(WORK_ITEM_KNOWLEDGE_END));

    // Only work items expose the work fields to the notes list.
    const notes = await listAllNotes(dbPath);
    assert.ok(notes.find((note) => note.noteId === item.noteId)?.work);
    const plain = await store.createLibraryNote("# Plain\n");
    assert.equal(notes.find((note) => note.noteId === plain.noteId), undefined);
    assert.equal((await listAllNotes(dbPath)).find((note) => note.noteId === plain.noteId)?.work, undefined);
  });
});

test("editing the heading renames the work item and re-applies the suffix", async () => {
  await withStore(async (store) => {
    const item = await store.createWorkItem({ title: "Ship release" });
    const raw = await readWorkItemFile(store, item.noteId);

    const edited = raw.replace(
      `# Ship release${DEFAULT_WORK_ITEM_TITLE_SUFFIX}`,
      "# Ship release v2"
    );
    const updated = await store.writeNoteContent(item.noteId, edited);
    assert.equal(updated.title, "Ship release v2");
    const after = await readWorkItemFile(store, item.noteId);
    assert.match(after, /title: "?Ship release v2"?/);
    assert.ok(after.includes(`# Ship release v2${DEFAULT_WORK_ITEM_TITLE_SUFFIX}`));

    // A body that lost its heading gets it back; agents cannot drop the reminder.
    const bodyOnly = raw.slice(raw.indexOf("\n---\n") + 5).replace(/^# .*\n/, "");
    const recovered = await store.writeNoteContent(
      item.noteId,
      `---\nid: ${item.noteId}\nscope: library\nwork: true\ntitle: Ship release v2\ntitleSuffix: "${DEFAULT_WORK_ITEM_TITLE_SUFFIX}"\n---\n\n${bodyOnly}`
    );
    assert.equal(recovered.title, "Ship release v2");
    assert.ok(
      (await readWorkItemFile(store, item.noteId)).includes(
        `# Ship release v2${DEFAULT_WORK_ITEM_TITLE_SUFFIX}`
      )
    );
  });
});

test("renaming a work item keeps its name and reminder suffix in step", async () => {
  await withStore(async (store) => {
    const item = await store.createWorkItem({ title: "Ship release" });
    const originalFilename = (await store.getNote(item.noteId)).filename;
    const renamed = await store.renameNote(item.noteId, "Release train");
    assert.equal(renamed.title, "Release train");
    // The work item is renamed, not its file: no collisions, no stale index.
    assert.equal(renamed.filename, originalFilename);
    const raw = await readWorkItemFile(store, item.noteId);
    assert.match(raw, /title: "?Release train"?/);
    assert.ok(raw.includes(`# Release train${DEFAULT_WORK_ITEM_TITLE_SUFFIX}`));

    // A name that already carries the suffix is not doubled.
    const again = await store.renameNote(
      item.noteId,
      `Release train${DEFAULT_WORK_ITEM_TITLE_SUFFIX}.md`
    );
    assert.equal(again.title, "Release train");
    assert.equal(again.filename, originalFilename);
    assert.ok(
      (await readWorkItemFile(store, item.noteId)).includes(
        `# Release train${DEFAULT_WORK_ITEM_TITLE_SUFFIX}`
      )
    );
  });
});

test("a work item can take a name another work item already uses as a file name", async () => {
  await withStore(async (store) => {
    // Reproduces the old flow: the first work item's FILE ended up named 安丰.md.
    const first = await store.createWorkItem({ title: "First" });
    await store.renameNote(first.noteId, "安丰");
    assert.equal((await store.getNote(first.noteId)).title, "安丰");

    const second = await store.createWorkItem({ title: "Second" });
    const renamed = await store.renameNote(second.noteId, "安丰");
    assert.equal(renamed.title, "安丰");
    assert.notEqual(renamed.filename, (await store.getNote(first.noteId)).filename);
  });
});

test("names stored only in the file name are recovered once", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-work-names-"));
  const dbPath = path.join(panelHome, "catalog.db");
  try {
    await ensureExtensionCatalogSchema(dbPath);
    const store = new NotesStore(dbPath, panelHome);
    await store.initialize();
    const item = await store.createWorkItem({});
    const record = await store.getNote(item.noteId);
    const absPath = store.absolutePath(record);
    // The old build renamed the file and left the body empty.
    const renamed = absPath.replace(/[^/]+$/, "安丰.md");
    await fs.rename(absPath, renamed);
    await runSqlite(dbPath, `UPDATE notes SET filename = '安丰.md', rel_md_path = 'notes/library/安丰.md', title = NULL WHERE note_id = '${item.noteId}';`);
    await runSqlite(dbPath, "DELETE FROM catalog_meta WHERE key IN ('work_item_notes_migrated_v1', 'work_item_notes_names_migrated_v1');");

    const reopened = new NotesStore(dbPath, panelHome);
    await reopened.initialize();

    const recovered = await reopened.getNote(item.noteId);
    assert.equal(recovered.title, "安丰");
    assert.equal(recovered.filename, "安丰.md");
    assert.ok(
      (await fs.readFile(renamed, "utf8")).includes(`# 安丰${DEFAULT_WORK_ITEM_TITLE_SUFFIX}`)
    );

    // A genuinely untitled work item keeps its default name.
    const untitled = await reopened.createWorkItem({});
    const afterRestart = new NotesStore(dbPath, panelHome);
    await afterRestart.initialize();
    assert.equal((await afterRestart.getNote(untitled.noteId)).title, "未命名工作项");
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});

test("prompt body is limited to the knowledge region", async () => {
  await withStore(async (store) => {
    const item = await store.createWorkItem({ title: "Scoped" });
    const raw = await readWorkItemFile(store, item.noteId);
    const withRegion = raw.replace(
      `${WORK_ITEM_KNOWLEDGE_BEGIN}\n\n${WORK_ITEM_KNOWLEDGE_END}`,
      `${WORK_ITEM_KNOWLEDGE_BEGIN}\n\nKeep me\n\n${WORK_ITEM_KNOWLEDGE_END}\n\nDrop me\n`
    );
    await store.writeNoteContent(item.noteId, withRegion);

    const prompt = workItemPromptBody(await store.readNoteContent(item.noteId));
    assert.ok(prompt.includes("Keep me"));
    assert.ok(!prompt.includes("Drop me"));
    assert.ok(prompt.includes("# Scoped"));

    // Without markers the whole body is used, so hand-written notes keep working.
    assert.equal(workItemPromptBody("# Plain\n\nEverything\n"), "# Plain\n\nEverything");
  });
});

test("moving a work item keeps its name and reminder suffix", async () => {
  await withStore(async (store) => {
    const item = await store.createWorkItem({ title: "Movable" });
    const moved = await store.moveNote(item.noteId, { scope: "project", projectPath: "/tmp/moved" });
    assert.equal(moved.scope, "project");
    assert.equal(moved.title, "Movable");

    const raw = await readWorkItemFile(store, item.noteId);
    assert.match(raw, /title: "?Movable"?/);
    assert.ok(raw.includes(`# Movable${DEFAULT_WORK_ITEM_TITLE_SUFFIX}`));
    assert.ok(!raw.includes(`${DEFAULT_WORK_ITEM_TITLE_SUFFIX}${DEFAULT_WORK_ITEM_TITLE_SUFFIX}`));
  });
});

test("reading a note reports whether it is a work item", async () => {
  await withStore(async (store) => {
    const item = await store.createWorkItem({ title: "Readable" });
    const plain = await store.createLibraryNote("# Plain\n");

    const readItem = await store.getNote(item.noteId);
    assert.ok(readItem.work, "a work item must report its work fields when read by id");
    assert.deepEqual(readItem.work.projects, undefined);
    assert.equal((await store.getNote(plain.noteId)).work, undefined);

    await store.renameNote(item.noteId, "Readable again");
    const afterRename = await store.getNote(item.noteId);
    assert.equal(afterRename.title, "Readable again");
    assert.ok(afterRename.work, "work fields survive a rename (the link tree depends on them)");
  });
});

test("existing work items are migrated once onto the convention", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-work-migrate-"));
  const dbPath = path.join(panelHome, "catalog.db");
  try {
    await ensureExtensionCatalogSchema(dbPath);
    const store = new NotesStore(dbPath, panelHome);
    await store.initialize();
    const item = await store.createWorkItem({ title: "Legacy item" });

    // Simulate a pre-migration file: plain heading, no front-matter title, no region.
    const record = await store.getNote(item.noteId);
    const absPath = store.absolutePath(record);
    await fs.writeFile(
      absPath,
      `---\nid: ${item.noteId}\nscope: library\nwork: true\n---\n\n# Legacy item\n\nOld notes\n`,
      "utf8"
    );
    await runSqlite(dbPath, "DELETE FROM catalog_meta WHERE key = 'work_item_notes_migrated_v1';");

    const reopened = new NotesStore(dbPath, panelHome);
    await reopened.initialize();

    const migrated = await fs.readFile(absPath, "utf8");
    assert.match(migrated, /title: "?Legacy item"?/);
    assert.ok(migrated.includes(`# Legacy item${DEFAULT_WORK_ITEM_TITLE_SUFFIX}`));
    assert.ok(migrated.includes(WORK_ITEM_KNOWLEDGE_BEGIN));
    assert.ok(migrated.includes("Old notes"));
    const updated = await reopened.getNote(item.noteId);
    assert.equal(updated.title, "Legacy item");

    // Second initialize must not rewrite the file again.
    const before = migrated;
    const third = new NotesStore(dbPath, panelHome);
    await third.initialize();
    assert.equal(await fs.readFile(absPath, "utf8"), before);
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
