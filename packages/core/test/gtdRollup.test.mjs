import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  NotesStore,
  listTaskGtdRollups,
  resolveTaskGtdRollup,
  rollupTaskGtdStatuses,
  setNoteGtdStatus,
  setSessionGtdStatus
} from "../dist/index.js";

test("rollupTaskGtdStatuses applies the deterministic ladder", () => {
  assert.deepEqual(rollupTaskGtdStatuses([]).status, "inbox");
  assert.deepEqual(rollupTaskGtdStatuses(["reference", "someday"]).status, "someday");
  assert.deepEqual(rollupTaskGtdStatuses(["reference", "inbox"]).status, "inbox");
  assert.deepEqual(rollupTaskGtdStatuses(["waiting", "inbox"]).status, "waiting");
  assert.deepEqual(rollupTaskGtdStatuses(["waiting", "next"]).status, "next");
  // `done` only wins when every contribution is done.
  assert.deepEqual(rollupTaskGtdStatuses(["done", "done"]).status, "done");
  assert.deepEqual(rollupTaskGtdStatuses(["done", "someday"]).status, "someday");
  assert.deepEqual(rollupTaskGtdStatuses(["done", "reference"]).status, "reference");
  assert.deepEqual(rollupTaskGtdStatuses(["done", "next"]).status, "next");
});

test("rollupTaskGtdStatuses counts every status including done", () => {
  const result = rollupTaskGtdStatuses(["next", "done", "done", "waiting"]);
  assert.equal(result.total, 4);
  assert.equal(result.counts.done, 2);
  assert.equal(result.counts.next, 1);
  assert.equal(result.counts.waiting, 1);
  assert.equal(result.status, "next");
});

async function setup() {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-gtd-rollup-"));
  const catalogDb = path.join(panelHome, "catalog.db");
  const store = new NotesStore(catalogDb, panelHome);
  await store.initialize();
  return { panelHome, catalogDb, store };
}

test("resolveTaskGtdRollup aggregates subtree notes and linked sessions", async () => {
  const { catalogDb, store } = await setup();
  const task = await store.createWorkItem({ title: "Rollup task", sessions: ["codex:s1"] });
  const child = await store.createLinkedChildNote(task.noteId, "# Child");

  await setNoteGtdStatus(catalogDb, child.noteId, "waiting");
  await setSessionGtdStatus(catalogDb, "codex", "s1", "next");

  const rollup = await resolveTaskGtdRollup(catalogDb, task.noteId);
  assert.equal(rollup.status, "next");
  assert.equal(rollup.override, undefined);
  assert.equal(rollup.total, 2);
  assert.equal(rollup.counts.waiting, 1);
  assert.equal(rollup.counts.next, 1);
});

test("unmarked children and sessions are neutral, and inbox is not a pin", async () => {
  const { catalogDb, store } = await setup();
  const task = await store.createWorkItem({ title: "Neutral task", sessions: ["codex:s2"] });
  await store.createLinkedChildNote(task.noteId, "# Unmarked child");
  // The work item's own default inbox must not pin it to inbox.
  await setNoteGtdStatus(catalogDb, task.noteId, "inbox");

  const rollup = await resolveTaskGtdRollup(catalogDb, task.noteId);
  assert.equal(rollup.override, undefined);
  assert.equal(rollup.total, 0);
  assert.equal(rollup.status, "inbox");
});

test("a non-inbox work item mark pins the task over the rollup", async () => {
  const { catalogDb, store } = await setup();
  const task = await store.createWorkItem({ title: "Pinned task", sessions: ["codex:s3"] });
  await setSessionGtdStatus(catalogDb, "codex", "s3", "next");
  await setNoteGtdStatus(catalogDb, task.noteId, "someday");

  const rollup = await resolveTaskGtdRollup(catalogDb, task.noteId);
  assert.equal(rollup.override, "someday");
  assert.equal(rollup.status, "someday");
  assert.equal(rollup.counts.next, 1);
});

test("listTaskGtdRollups matches the single-task rollup", async () => {
  const { catalogDb, store } = await setup();
  const task = await store.createWorkItem({ title: "Bulk task", sessions: ["codex:s4"] });
  await setSessionGtdStatus(catalogDb, "codex", "s4", "next");

  const bulk = await listTaskGtdRollups(catalogDb);
  const single = await resolveTaskGtdRollup(catalogDb, task.noteId);
  assert.deepEqual(bulk[task.noteId], single);
  assert.equal(bulk[task.noteId].status, "next");
});
