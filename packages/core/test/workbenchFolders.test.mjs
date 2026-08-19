import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assignWorkbenchSessionToFolder,
  createWorkbenchSessionFolder,
  deleteWorkbenchSessionFolder,
  ensureDesktopDbSchema,
  listWorkbenchSessionFolderAssignments,
  listWorkbenchSessionFolders,
  listAllWorkbenchSessionFolders,
  listAllWorkbenchSessionFolderAssignments,
  mergeWorkbenchSessionFolders,
  removeWorkbenchSessionFromFolder,
  renameWorkbenchSessionFolder
} from "../dist/index.js";

test("Workbench folders support arbitrary nesting and session reassignment", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-workbench-folders-"));
  const dbPath = path.join(root, "desktop.db");
  try {
    await ensureDesktopDbSchema(dbPath);
    const projectId = "project-1";
    const campaign = await createWorkbenchSessionFolder(dbPath, projectId, null, "Campaign");
    const phase = await createWorkbenchSessionFolder(dbPath, projectId, campaign.folderId, "Phase 1");
    const task = await createWorkbenchSessionFolder(dbPath, projectId, phase.folderId, "Task A");

    assert.deepEqual(
      (await listWorkbenchSessionFolders(dbPath, projectId)).map((folder) => [folder.name, folder.parentId]),
      [["Campaign", null], ["Phase 1", campaign.folderId], ["Task A", phase.folderId]]
    );

    await assignWorkbenchSessionToFolder(dbPath, projectId, "codex", "session-1", task.folderId);
    const firstAssignment = (await listWorkbenchSessionFolderAssignments(dbPath, projectId))[0];
    assert.equal(firstAssignment.projectId, projectId);
    assert.equal(firstAssignment.provider, "codex");
    assert.equal(firstAssignment.agentSessionId, "session-1");
    assert.equal(firstAssignment.folderId, task.folderId);
    assert.equal(typeof firstAssignment.updatedAtMs, "number");

    await assignWorkbenchSessionToFolder(dbPath, projectId, "codex", "session-1", campaign.folderId);
    assert.equal((await listWorkbenchSessionFolderAssignments(dbPath, projectId))[0].folderId, campaign.folderId);

    const renamed = await renameWorkbenchSessionFolder(dbPath, phase.folderId, "Phase 1 renamed");
    assert.equal(renamed.name, "Phase 1 renamed");

    await deleteWorkbenchSessionFolder(dbPath, campaign.folderId);
    const remaining = await listWorkbenchSessionFolders(dbPath, projectId);
    assert.deepEqual(remaining.map((folder) => [folder.name, folder.parentId]), [["Phase 1 renamed", null], ["Task A", phase.folderId]]);
    assert.deepEqual(await listWorkbenchSessionFolderAssignments(dbPath, projectId), []);

    await removeWorkbenchSessionFromFolder(dbPath, "codex", "session-1");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Workbench folders survive catalog project merges without sibling name collisions", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-workbench-folder-merge-"));
  const dbPath = path.join(root, "desktop.db");
  try {
    await ensureDesktopDbSchema(dbPath);
    const source = await createWorkbenchSessionFolder(dbPath, "source", null, "Campaign");
    await createWorkbenchSessionFolder(dbPath, "target", null, "Campaign");
    await assignWorkbenchSessionToFolder(dbPath, "source", "codex", "session-1", source.folderId);

    const result = await mergeWorkbenchSessionFolders(dbPath, "source", "target");
    assert.deepEqual(result, { movedFolders: 1, movedAssignments: 1 });
    const folders = await listWorkbenchSessionFolders(dbPath, "target");
    assert.deepEqual(folders.map((folder) => folder.name), ["Campaign", "Campaign (2)"]);
    const assignment = (await listWorkbenchSessionFolderAssignments(dbPath, "target"))[0];
    assert.equal(assignment.folderId, folders.find((folder) => folder.name === "Campaign (2)").folderId);
    assert.deepEqual(await listWorkbenchSessionFolders(dbPath, "source"), []);
    const allFolders = await listAllWorkbenchSessionFolders(dbPath);
    const allAssignments = await listAllWorkbenchSessionFolderAssignments(dbPath);
    assert.equal(allFolders.length, 2);
    assert.equal(allAssignments.length, 1);
    assert.equal(allAssignments[0].projectId, "target");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
