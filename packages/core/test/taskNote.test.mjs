import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  NotesStore,
  TASK_KNOWLEDGE_BEGIN,
  TASK_KNOWLEDGE_END,
  ensureExtensionCatalogSchema,
  listAllNotes,
  runSqlite,
  taskPromptBody
} from "../dist/index.js";

/** Heading reminder suffix from before headings carried only the name. */
const LEGACY_TITLE_SUFFIX = "-背景知识(会被AI索引)";

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

async function readTaskFile(store, noteId) {
  const record = await store.getNote(noteId);
  return fs.readFile(store.absolutePath(record), "utf8");
}

test("new tasks carry a front-matter name, a plain heading and a knowledge region", async () => {
  await withStore(async (store, _home, dbPath) => {
    const item = await store.createTask({ title: "Ship release" });
    assert.equal(item.title, "Ship release");

    const raw = await readTaskFile(store, item.noteId);
    assert.match(raw, /title: "?Ship release"?/);
    assert.ok(raw.includes("# Ship release\n"));
    assert.ok(!raw.includes("titleSuffix"));
    assert.ok(raw.includes(TASK_KNOWLEDGE_BEGIN));
    assert.ok(raw.includes(TASK_KNOWLEDGE_END));

    // Only tasks expose the work fields to the notes list.
    const notes = await listAllNotes(dbPath);
    assert.ok(notes.find((note) => note.noteId === item.noteId)?.work);
    const plain = await store.createLibraryNote("# Plain\n");
    assert.equal(notes.find((note) => note.noteId === plain.noteId), undefined);
    assert.equal((await listAllNotes(dbPath)).find((note) => note.noteId === plain.noteId)?.work, undefined);
  });
});

test("editing the heading renames the task", async () => {
  await withStore(async (store) => {
    const item = await store.createTask({ title: "Ship release" });
    const raw = await readTaskFile(store, item.noteId);

    const edited = raw.replace("# Ship release", "# Ship release v2");
    const updated = await store.writeNoteContent(item.noteId, edited);
    assert.equal(updated.title, "Ship release v2");
    assert.equal(updated.filename, "Ship release v2.md");
    const after = await readTaskFile(store, item.noteId);
    assert.match(after, /title: "?Ship release v2"?/);
    assert.ok(after.includes("# Ship release v2\n"));

    // A body that lost its heading gets it back. A legacy file still carrying
    // titleSuffix has it stripped and dropped on the same write.
    const bodyOnly = raw.slice(raw.indexOf("\n---\n") + 5).replace(/^# .*\n/, "");
    const recovered = await store.writeNoteContent(
      item.noteId,
      `---\nid: ${item.noteId}\nscope: library\nwork: true\ntitle: Ship release v2\ntitleSuffix: "${LEGACY_TITLE_SUFFIX}"\n---\n\n${bodyOnly}`
    );
    assert.equal(recovered.title, "Ship release v2");
    const recoveredRaw = await readTaskFile(store, item.noteId);
    assert.ok(recoveredRaw.includes("# Ship release v2\n"));
    assert.ok(!recoveredRaw.includes("titleSuffix"));
    assert.ok(!recoveredRaw.includes("背景知识"));
  });
});

test("renaming a task keeps its name and file in step", async () => {
  await withStore(async (store) => {
    const item = await store.createTask({ title: "Ship release" });
    assert.equal((await store.getNote(item.noteId)).filename, "Ship release.md");
    const renamed = await store.renameNote(item.noteId, "Release train");
    assert.equal(renamed.title, "Release train");
    // The file follows the name, so surfaced paths carry the real name.
    assert.equal(renamed.filename, "Release train.md");
    assert.equal(renamed.relMdPath, "notes/library/Release train.md");
    const raw = await readTaskFile(store, item.noteId);
    assert.match(raw, /title: "?Release train"?/);
    assert.ok(raw.includes("# Release train\n"));

    // A name ending in .md is treated as a file name: the stem is the name.
    const again = await store.renameNote(item.noteId, "Release train.md");
    assert.equal(again.title, "Release train");
    assert.equal(again.filename, "Release train.md");
    assert.ok((await readTaskFile(store, item.noteId)).includes("# Release train\n"));
  });
});

test("an untitled task's file follows the name once it is named", async () => {
  await withStore(async (store) => {
    const item = await store.createTask({});
    assert.equal((await store.getNote(item.noteId)).filename, "未命名任务.md");

    const renamed = await store.renameNote(item.noteId, "agent 重构");
    assert.equal(renamed.title, "agent 重构");
    assert.equal(renamed.filename, "agent 重构.md");
    assert.equal(renamed.relMdPath, "notes/library/agent 重构.md");
    const raw = await readTaskFile(store, item.noteId);
    assert.match(raw, /title: "?agent 重构"?/);
    assert.ok(raw.includes("# agent 重构\n"));
  });
});

test("editing the heading moves the task's file to the new name", async () => {
  await withStore(async (store) => {
    const item = await store.createTask({ title: "Ship release" });
    const raw = await readTaskFile(store, item.noteId);

    const edited = raw.replace("# Ship release", "# Ship release v2");
    const updated = await store.writeNoteContent(item.noteId, edited);
    assert.equal(updated.title, "Ship release v2");
    assert.equal(updated.filename, "Ship release v2.md");
    assert.equal((await store.getNote(item.noteId)).filename, "Ship release v2.md");
  });
});

test("a task can take a name another task already uses as a file name", async () => {
  await withStore(async (store) => {
    // Reproduces the old flow: the first task's FILE ended up named 安丰.md.
    const first = await store.createTask({ title: "First" });
    await store.renameNote(first.noteId, "安丰");
    assert.equal((await store.getNote(first.noteId)).title, "安丰");
    assert.equal((await store.getNote(first.noteId)).filename, "安丰.md");

    const second = await store.createTask({ title: "Second" });
    const renamed = await store.renameNote(second.noteId, "安丰");
    assert.equal(renamed.title, "安丰");
    // Collision: the second file gets a suffix instead of failing.
    assert.equal(renamed.filename, "安丰-2.md");
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
    const item = await store.createTask({});
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
      (await fs.readFile(renamed, "utf8")).includes("# 安丰\n")
    );

    // A genuinely untitled task keeps its default name.
    const untitled = await reopened.createTask({});
    const afterRestart = new NotesStore(dbPath, panelHome);
    await afterRestart.initialize();
    assert.equal((await afterRestart.getNote(untitled.noteId)).title, "未命名任务");
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});

test("prompt body is limited to the knowledge region", async () => {
  await withStore(async (store) => {
    const item = await store.createTask({ title: "Scoped" });
    const raw = await readTaskFile(store, item.noteId);
    const withRegion = raw.replace(
      `${TASK_KNOWLEDGE_BEGIN}\n\n${TASK_KNOWLEDGE_END}`,
      `${TASK_KNOWLEDGE_BEGIN}\n\nKeep me\n\n${TASK_KNOWLEDGE_END}\n\nDrop me\n`
    );
    await store.writeNoteContent(item.noteId, withRegion);

    const prompt = taskPromptBody(await store.readNoteContent(item.noteId));
    assert.ok(prompt.includes("Keep me"));
    assert.ok(!prompt.includes("Drop me"));
    assert.ok(prompt.includes("# Scoped"));

    // Without markers the whole body is used, so hand-written notes keep working.
    assert.equal(taskPromptBody("# Plain\n\nEverything\n"), "# Plain\n\nEverything");
  });
});

test("moving a task keeps its name", async () => {
  await withStore(async (store) => {
    const item = await store.createTask({ title: "Movable" });
    const moved = await store.moveNote(item.noteId, { scope: "project", projectPath: "/tmp/moved" });
    assert.equal(moved.scope, "project");
    assert.equal(moved.title, "Movable");

    const raw = await readTaskFile(store, item.noteId);
    assert.match(raw, /title: "?Movable"?/);
    assert.ok(raw.includes("# Movable\n"));
    assert.ok(!raw.includes("titleSuffix"));
  });
});

test("reading a note reports whether it is a task", async () => {
  await withStore(async (store) => {
    const item = await store.createTask({ title: "Readable" });
    const plain = await store.createLibraryNote("# Plain\n");

    const readItem = await store.getNote(item.noteId);
    assert.ok(readItem.work, "a task must report its work fields when read by id");
    assert.deepEqual(readItem.work.projects, undefined);
    assert.equal((await store.getNote(plain.noteId)).work, undefined);

    await store.renameNote(item.noteId, "Readable again");
    const afterRename = await store.getNote(item.noteId);
    assert.equal(afterRename.title, "Readable again");
    assert.ok(afterRename.work, "work fields survive a rename (the link tree depends on them)");
  });
});

test("existing tasks are migrated once onto the convention", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-work-migrate-"));
  const dbPath = path.join(panelHome, "catalog.db");
  try {
    await ensureExtensionCatalogSchema(dbPath);
    const store = new NotesStore(dbPath, panelHome);
    await store.initialize();
    const item = await store.createTask({ title: "Legacy item" });

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
    assert.ok(migrated.includes("# Legacy item\n"));
    assert.ok(migrated.includes(TASK_KNOWLEDGE_BEGIN));
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

test("task files left behind by the old flow are renamed to their name once", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-work-files-"));
  const dbPath = path.join(panelHome, "catalog.db");
  try {
    await ensureExtensionCatalogSchema(dbPath);
    const store = new NotesStore(dbPath, panelHome);
    await store.initialize();
    // Reproduces the incident: file allocated as 未命名任务.md, then the
    // name moved to agent 重构 while the file stayed put.
    const item = await store.createTask({});
    const record = await store.getNote(item.noteId);
    const oldPath = store.absolutePath(record);
    await fs.writeFile(
      oldPath,
      `---\nid: ${item.noteId}\nscope: library\nwork: true\ntitle: agent 重构\ntitleSuffix: "${LEGACY_TITLE_SUFFIX}"\n---\n\n# agent 重构${LEGACY_TITLE_SUFFIX}\n\n${TASK_KNOWLEDGE_BEGIN}\n\n${TASK_KNOWLEDGE_END}\n`,
      "utf8"
    );
    await runSqlite(dbPath, `UPDATE notes SET title = 'agent 重构' WHERE note_id = '${item.noteId}';`);
    await runSqlite(dbPath, "DELETE FROM catalog_meta WHERE key IN ('work_item_files_follow_title_v1', 'work_item_notes_suffix_dropped_v1');");

    const reopened = new NotesStore(dbPath, panelHome);
    await reopened.initialize();

    const updated = await reopened.getNote(item.noteId);
    assert.equal(updated.title, "agent 重构");
    assert.equal(updated.filename, "agent 重构.md");
    assert.equal(updated.relMdPath, "notes/library/agent 重构.md");
    const migrated = await fs.readFile(path.join(panelHome, "notes", "library", "agent 重构.md"), "utf8");
    assert.ok(migrated.includes("# agent 重构\n"));
    assert.ok(!migrated.includes("titleSuffix"));
    await assert.rejects(fs.access(oldPath));

    // Second initialize must not rename again.
    const third = new NotesStore(dbPath, panelHome);
    await third.initialize();
    assert.equal((await third.getNote(item.noteId)).filename, "agent 重构.md");
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});

test("legacy heading suffixes are dropped once", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-work-suffix-"));
  const dbPath = path.join(panelHome, "catalog.db");
  try {
    await ensureExtensionCatalogSchema(dbPath);
    const store = new NotesStore(dbPath, panelHome);
    await store.initialize();
    const item = await store.createTask({ title: "Ship release" });
    const record = await store.getNote(item.noteId);
    const absPath = store.absolutePath(record);
    // Old-style file: heading with the reminder suffix and a titleSuffix field.
    await fs.writeFile(
      absPath,
      `---\nid: ${item.noteId}\nscope: library\nwork: true\ntitle: Ship release\ntitleSuffix: "${LEGACY_TITLE_SUFFIX}"\n---\n\n# Ship release${LEGACY_TITLE_SUFFIX}\n\n${TASK_KNOWLEDGE_BEGIN}\n\n${TASK_KNOWLEDGE_END}\n`,
      "utf8"
    );
    await runSqlite(dbPath, "DELETE FROM catalog_meta WHERE key = 'work_item_notes_suffix_dropped_v1';");

    const reopened = new NotesStore(dbPath, panelHome);
    await reopened.initialize();

    const migrated = await fs.readFile(absPath, "utf8");
    assert.ok(migrated.includes("# Ship release\n"));
    assert.ok(!migrated.includes("背景知识"));
    assert.ok(!migrated.includes("titleSuffix"));
    assert.equal((await reopened.getNote(item.noteId)).title, "Ship release");

    // Second initialize must not rewrite the file again.
    const third = new NotesStore(dbPath, panelHome);
    await third.initialize();
    assert.equal(await fs.readFile(absPath, "utf8"), migrated);
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});
