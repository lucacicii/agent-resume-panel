import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assignSessionToTaskWorkbench,
  createTaskWorkbench,
  deleteTaskWorkbench,
  desktopDbPath,
  ensureDesktopDbSchema,
  ensureTaskWorkbench,
  getTaskWorkbench,
  listTaskWorkbenchSessionLinks,
  listTaskWorkbenches,
  removeSessionFromTaskWorkbench,
  renameTaskWorkbench,
  reorderTaskWorkbenches,
  setTaskWorkbenchProject
} from "../dist/index.js";

async function withDesktopDb(fn) {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-wb-"));
  const desktopDb = desktopDbPath(panelHome);
  try {
    await ensureDesktopDbSchema(desktopDb);
    await fn(desktopDb);
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
}

test("ensureTaskWorkbench creates a default workbench only once", async () => {
  await withDesktopDb(async (db) => {
    const first = await ensureTaskWorkbench(db, "task-1");
    assert.equal(first.taskNoteId, "task-1");
    assert.equal(first.name, "Workbench 1");
    assert.equal(first.position, 0);
    assert.equal(first.projectPath, null);

    const second = await ensureTaskWorkbench(db, "task-1");
    assert.equal(second.workbenchId, first.workbenchId);

    const list = await listTaskWorkbenches(db, "task-1");
    assert.equal(list.length, 1);
  });
});

test("createTaskWorkbench appends ascending positions and binds a project", async () => {
  await withDesktopDb(async (db) => {
    const a = await createTaskWorkbench(db, { taskNoteId: "task-1", projectPath: "/repo/api" });
    const b = await createTaskWorkbench(db, { taskNoteId: "task-1", name: "Frontend", projectPath: "/repo/web" });
    assert.equal(a.position, 0);
    assert.equal(b.position, 1);
    assert.equal(b.name, "Frontend");
    assert.equal(b.projectPath, "/repo/web");

    const list = await listTaskWorkbenches(db, "task-1");
    assert.deepEqual(list.map((item) => item.workbenchId), [a.workbenchId, b.workbenchId]);
  });
});

test("rename and set-project update the persisted workbench", async () => {
  await withDesktopDb(async (db) => {
    const created = await createTaskWorkbench(db, { taskNoteId: "task-1" });
    const renamed = await renameTaskWorkbench(db, created.workbenchId, "Spike");
    assert.equal(renamed.name, "Spike");
    const moved = await setTaskWorkbenchProject(db, created.workbenchId, "/repo/api");
    assert.equal(moved.projectPath, "/repo/api");
    const cleared = await setTaskWorkbenchProject(db, created.workbenchId, null);
    assert.equal(cleared.projectPath, null);
  });
});

test("reorderTaskWorkbenches reorders only task-owned workbenches", async () => {
  await withDesktopDb(async (db) => {
    const a = await createTaskWorkbench(db, { taskNoteId: "task-1", name: "A" });
    const b = await createTaskWorkbench(db, { taskNoteId: "task-1", name: "B" });
    const c = await createTaskWorkbench(db, { taskNoteId: "task-1", name: "C" });
    const foreign = await createTaskWorkbench(db, { taskNoteId: "task-2", name: "X" });

    await reorderTaskWorkbenches(db, "task-1", [c.workbenchId, foreign.workbenchId, a.workbenchId, b.workbenchId]);
    const list = await listTaskWorkbenches(db, "task-1");
    assert.deepEqual(list.map((item) => item.name), ["C", "A", "B"]);
    // The foreign workbench is untouched.
    const other = await listTaskWorkbenches(db, "task-2");
    assert.equal(other[0].workbenchId, foreign.workbenchId);
  });
});

test("session links are scoped to a workbench and removed with it", async () => {
  await withDesktopDb(async (db) => {
    const wb = await createTaskWorkbench(db, { taskNoteId: "task-1" });
    await assignSessionToTaskWorkbench(db, wb.workbenchId, "codex", "s-1");
    await assignSessionToTaskWorkbench(db, wb.workbenchId, "claude", "s-2");
    let links = await listTaskWorkbenchSessionLinks(db, wb.workbenchId);
    assert.equal(links.length, 2);

    await removeSessionFromTaskWorkbench(db, wb.workbenchId, "codex", "s-1");
    links = await listTaskWorkbenchSessionLinks(db, wb.workbenchId);
    assert.deepEqual(links.map((link) => `${link.provider}:${link.agentSessionId}`), ["claude:s-2"]);

    await deleteTaskWorkbench(db, wb.workbenchId);
    assert.equal(await getTaskWorkbench(db, wb.workbenchId), null);
    assert.deepEqual(await listTaskWorkbenchSessionLinks(db, wb.workbenchId), []);
  });
});
