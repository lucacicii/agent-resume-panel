import type { TaskWorkbench } from "@agent-resume/core";
import { desktopApi } from "../../bridge";

/**
 * A workbench as the renderer sees it: one desktop workspace under a GTD task.
 * The shape is mirrored from core's `TaskWorkbench` (the preload bridge returns
 * a structural copy).
 */
export type Workbench = TaskWorkbench;

/** Human label for a workbench tab: explicit name, else the bound project, else a fallback. */
export function workbenchDisplayName(workbench: Workbench): string {
  const name = workbench.name?.trim();
  if (name) return name;
  if (workbench.projectPath) {
    return workbench.projectPath.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) || workbench.projectPath;
  }
  return "Workbench";
}

export async function listTaskWorkbenches(taskNoteId: string): Promise<Workbench[]> {
  const api = desktopApi();
  if (typeof api.listTaskWorkbenches !== "function") return [];
  return api.listTaskWorkbenches({ taskNoteId });
}

export async function listAllTaskWorkbenches(): Promise<Workbench[]> {
  const api = desktopApi();
  if (typeof api.listAllTaskWorkbenches !== "function") return [];
  return api.listAllTaskWorkbenches();
}

/** Load the task's workbenches, guaranteeing at least one exists. */
export async function ensureTaskWorkbenches(taskNoteId: string): Promise<Workbench[]> {
  const api = desktopApi();
  if (typeof api.ensureTaskWorkbench !== "function" || typeof api.listTaskWorkbenches !== "function") {
    return [];
  }
  await api.ensureTaskWorkbench({ taskNoteId });
  return api.listTaskWorkbenches({ taskNoteId });
}

export async function createTaskWorkbench(
  taskNoteId: string,
  options?: { name?: string; projectPath?: string | null }
): Promise<Workbench | null> {
  const api = desktopApi();
  if (typeof api.createTaskWorkbench !== "function") return null;
  return api.createTaskWorkbench({ taskNoteId, ...options });
}

export async function renameTaskWorkbench(workbenchId: string, name: string): Promise<Workbench | null> {
  const api = desktopApi();
  if (typeof api.renameTaskWorkbench !== "function") return null;
  return api.renameTaskWorkbench({ workbenchId, name });
}

export async function setTaskWorkbenchProject(
  workbenchId: string,
  projectPath: string | null
): Promise<Workbench | null> {
  const api = desktopApi();
  if (typeof api.setTaskWorkbenchProject !== "function") return null;
  return api.setTaskWorkbenchProject({ workbenchId, projectPath });
}

export async function setTaskWorkbenchLayout(workbenchId: string, layoutJson: string | null): Promise<void> {
  const api = desktopApi();
  if (typeof api.setTaskWorkbenchLayout !== "function") return;
  await api.setTaskWorkbenchLayout({ workbenchId, layoutJson });
}

export async function deleteTaskWorkbench(workbenchId: string): Promise<void> {
  const api = desktopApi();
  if (typeof api.deleteTaskWorkbench !== "function") return;
  await api.deleteTaskWorkbench({ workbenchId });
}

export async function reorderTaskWorkbenches(taskNoteId: string, orderedIds: string[]): Promise<void> {
  const api = desktopApi();
  if (typeof api.reorderTaskWorkbenches !== "function") return;
  await api.reorderTaskWorkbenches({ taskNoteId, orderedIds });
}

/**
 * Persisted "which workbench was last active" per task, so re-opening a task
 * restores the same workspace. Kept in localStorage: it is pure UI preference.
 */
const ACTIVE_WORKBENCH_PREFIX = "workbench-active-v1:";

export function readActiveWorkbenchId(taskNoteId: string): string | null {
  try {
    return localStorage.getItem(`${ACTIVE_WORKBENCH_PREFIX}${taskNoteId}`);
  } catch {
    return null;
  }
}

export function writeActiveWorkbenchId(taskNoteId: string, workbenchId: string): void {
  try {
    localStorage.setItem(`${ACTIVE_WORKBENCH_PREFIX}${taskNoteId}`, workbenchId);
  } catch {
    /* persistence is optional */
  }
}
