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
  renderTaskContext,
  writeTaskContextFile
} from "../dist/index.js";

async function withStore(run) {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-task-context-"));
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

async function createTaskWithKnowledge(store, input) {
  const item = await store.createTask(input);
  const record = await store.getNote(item.noteId);
  const raw = await fs.readFile(store.absolutePath(record), "utf8");
  const next = raw.replace(
    TASK_KNOWLEDGE_END,
    `The API lives in api/.\nRun pnpm test first.\n${TASK_KNOWLEDGE_END}`
  );
  await store.writeNoteContent(item.noteId, next);
  return item;
}

test("renderTaskContext renders facts, repositories and knowledge — no policy, no heading", async () => {
  await withStore(async (store, panelHome, dbPath) => {
    const item = await createTaskWithKnowledge(store, {
      title: "Ship release",
      next: "Cut a release",
      decision: "Pick a color",
      projects: ["/work/app", "/work/api"]
    });

    const text = await renderTaskContext({ panelHome, catalogDb: dbPath, noteId: item.noteId });
    assert.ok(text);
    const [head, ...rest] = text.split("\n");
    assert.match(head, /^# Task: Ship release \(note: .+Ship release\.md\)$/);
    assert.ok(text.includes("Status: inbox · Next: Cut a release · Decision: Pick a color"));
    assert.ok(text.includes("Repos: app → /work/app; api → /work/api"));
    assert.ok(text.includes("Docs: durable → the task note (note_append); throwaway → /tmp."));
    assert.ok(text.includes("The API lives in api/."));
    assert.ok(text.includes("Run pnpm test first."));
    // The note's own heading must not ride along with the knowledge region.
    assert.ok(!rest.some((line) => line.trim() === "# Ship release"));
    // The panel editorializes nothing: no worktree or PR discipline text.
    assert.ok(!text.includes("worktree"));
    assert.ok(!text.includes("PR"));
  });
});

test("renderTaskContext survives a missing note file and unknown ids", async () => {
  await withStore(async (store, panelHome, dbPath) => {
    const item = await store.createTask({ title: "Orphan" });
    const record = await store.getNote(item.noteId);
    await fs.rm(store.absolutePath(record));
    const degraded = await renderTaskContext({ panelHome, catalogDb: dbPath, noteId: item.noteId });
    assert.match(degraded || "", /^# Task: Orphan \(note: /);

    assert.equal(await renderTaskContext({ panelHome, catalogDb: dbPath, noteId: "missing" }), undefined);
  });
});

test("writeTaskContextFile writes one deterministic, refreshable file per task", async () => {
  await withStore(async (store, panelHome, dbPath) => {
    const item = await createTaskWithKnowledge(store, { title: "Ship release" });
    const first = await writeTaskContextFile({ panelHome, catalogDb: dbPath, noteId: item.noteId });
    const second = await writeTaskContextFile({ panelHome, catalogDb: dbPath, noteId: item.noteId });
    assert.equal(first, second);
    assert.ok(first?.includes(item.noteId));
    const onDisk = await fs.readFile(first, "utf8");
    assert.match(onDisk, /^# Task: Ship release \(note: /);
  });
});
