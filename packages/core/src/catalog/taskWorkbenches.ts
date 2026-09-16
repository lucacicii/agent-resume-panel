import { randomUUID } from "node:crypto";
import { escapeSqlLiteral, runSqliteJson, runSqliteTransaction } from "../sqlite";

/**
 * A workbench is a desktop-only unit of work under a GTD task (a `work: true`
 * note). One task can hold several workbenches; each one binds to a project
 * path (or runs in the task's neutral workspace when `projectPath` is null) and
 * owns its own pane layout and session set.
 *
 * This is deliberately stored in `desktop.db`, not in note front-matter: the
 * extension has no notion of a workbench, and keeping it here leaves the shared
 * catalog schema untouched.
 */
export interface TaskWorkbench {
  workbenchId: string;
  taskNoteId: string;
  name: string;
  projectPath: string | null;
  /** Order within the task's workbench tab strip (ascending). */
  position: number;
  /** Optional serialized pane layout (open note / session / files). */
  layoutJson: string | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface TaskWorkbenchSessionLink {
  workbenchId: string;
  provider: string;
  agentSessionId: string;
  updatedAtMs: number;
}

interface TaskWorkbenchRow {
  workbench_id: string;
  task_note_id: string;
  name: string;
  project_path: string | null;
  position: number;
  layout_json: string | null;
  created_at_ms: number;
  updated_at_ms: number;
}

interface TaskWorkbenchSessionRow {
  workbench_id: string;
  provider: string;
  agent_session_id: string;
  updated_at_ms: number;
}

const DEFAULT_WORKBENCH_NAME = "Workbench";

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function workbenchName(value: string): string {
  const normalized = required(value, "Workbench name");
  if (normalized.length > 200) throw new Error("Workbench name is too long.");
  return normalized;
}

function toWorkbench(row: TaskWorkbenchRow): TaskWorkbench {
  return {
    workbenchId: row.workbench_id,
    taskNoteId: row.task_note_id,
    name: row.name,
    projectPath: row.project_path || null,
    position: Number(row.position) || 0,
    layoutJson: row.layout_json || null,
    createdAtMs: Number(row.created_at_ms) || 0,
    updatedAtMs: Number(row.updated_at_ms) || 0
  };
}

export async function listTaskWorkbenches(
  dbPath: string,
  taskNoteId: string
): Promise<TaskWorkbench[]> {
  const rows = await runSqliteJson<TaskWorkbenchRow>(
    dbPath,
    `SELECT workbench_id, task_note_id, name, project_path, position, layout_json, created_at_ms, updated_at_ms
     FROM task_workbenches
     WHERE task_note_id = '${escapeSqlLiteral(taskNoteId)}'
     ORDER BY position ASC, created_at_ms ASC;`
  );
  return rows.map(toWorkbench);
}

/** Every workbench across all tasks, for the GTD board's per-task counts. */
export async function listAllTaskWorkbenches(dbPath: string): Promise<TaskWorkbench[]> {
  const rows = await runSqliteJson<TaskWorkbenchRow>(
    dbPath,
    `SELECT workbench_id, task_note_id, name, project_path, position, layout_json, created_at_ms, updated_at_ms
     FROM task_workbenches
     ORDER BY task_note_id ASC, position ASC, created_at_ms ASC;`
  );
  return rows.map(toWorkbench);
}

export async function getTaskWorkbench(
  dbPath: string,
  workbenchId: string
): Promise<TaskWorkbench | null> {
  const rows = await runSqliteJson<TaskWorkbenchRow>(
    dbPath,
    `SELECT workbench_id, task_note_id, name, project_path, position, layout_json, created_at_ms, updated_at_ms
     FROM task_workbenches
     WHERE workbench_id = '${escapeSqlLiteral(workbenchId)}'
     LIMIT 1;`
  );
  return rows[0] ? toWorkbench(rows[0]) : null;
}

export async function createTaskWorkbench(
  dbPath: string,
  options: { taskNoteId: string; name?: string; projectPath?: string | null }
): Promise<TaskWorkbench> {
  const taskNoteId = required(options.taskNoteId, "Task note ID");
  const now = Date.now();
  const existing = await listTaskWorkbenches(dbPath, taskNoteId);
  const position = existing.reduce((max, item) => Math.max(max, item.position), -1) + 1;
  const name = options.name?.trim()
    ? workbenchName(options.name)
    : `${DEFAULT_WORKBENCH_NAME} ${position + 1}`;
  const workbenchId = `wb_${randomUUID()}`;
  const projectPath = options.projectPath?.trim() || null;

  await runSqliteTransaction(dbPath, [`
    INSERT INTO task_workbenches
      (workbench_id, task_note_id, name, project_path, position, layout_json, created_at_ms, updated_at_ms)
    VALUES
      ('${escapeSqlLiteral(workbenchId)}', '${escapeSqlLiteral(taskNoteId)}', '${escapeSqlLiteral(name)}',
       ${projectPath ? `'${escapeSqlLiteral(projectPath)}'` : "NULL"}, ${position}, NULL, ${now}, ${now})
  `]);

  return {
    workbenchId,
    taskNoteId,
    name,
    projectPath,
    position,
    layoutJson: null,
    createdAtMs: now,
    updatedAtMs: now
  };
}

export async function renameTaskWorkbench(
  dbPath: string,
  workbenchId: string,
  name: string
): Promise<TaskWorkbench> {
  const normalizedId = required(workbenchId, "Workbench ID");
  const normalizedName = workbenchName(name);
  const now = Date.now();
  await runSqliteTransaction(dbPath, [`
    UPDATE task_workbenches
    SET name = '${escapeSqlLiteral(normalizedName)}', updated_at_ms = ${now}
    WHERE workbench_id = '${escapeSqlLiteral(normalizedId)}'
  `]);
  const updated = await getTaskWorkbench(dbPath, normalizedId);
  if (!updated) throw new Error("Workbench not found.");
  return updated;
}

export async function setTaskWorkbenchProject(
  dbPath: string,
  workbenchId: string,
  projectPath: string | null
): Promise<TaskWorkbench> {
  const normalizedId = required(workbenchId, "Workbench ID");
  const normalizedPath = projectPath?.trim() || null;
  const now = Date.now();
  await runSqliteTransaction(dbPath, [`
    UPDATE task_workbenches
    SET project_path = ${normalizedPath ? `'${escapeSqlLiteral(normalizedPath)}'` : "NULL"}, updated_at_ms = ${now}
    WHERE workbench_id = '${escapeSqlLiteral(normalizedId)}'
  `]);
  const updated = await getTaskWorkbench(dbPath, normalizedId);
  if (!updated) throw new Error("Workbench not found.");
  return updated;
}

export async function setTaskWorkbenchLayout(
  dbPath: string,
  workbenchId: string,
  layoutJson: string | null
): Promise<void> {
  const normalizedId = required(workbenchId, "Workbench ID");
  await runSqliteTransaction(dbPath, [`
    UPDATE task_workbenches
    SET layout_json = ${layoutJson ? `'${escapeSqlLiteral(layoutJson)}'` : "NULL"}, updated_at_ms = ${Date.now()}
    WHERE workbench_id = '${escapeSqlLiteral(normalizedId)}'
  `]);
}

export async function reorderTaskWorkbenches(
  dbPath: string,
  taskNoteId: string,
  orderedIds: string[]
): Promise<void> {
  const normalizedTask = required(taskNoteId, "Task note ID");
  const owned = await listTaskWorkbenches(dbPath, normalizedTask);
  const ownedIds = new Set(owned.map((item) => item.workbenchId));
  const now = Date.now();
  const statements = orderedIds
    .filter((id) => ownedIds.has(id))
    .map((id, index) => `UPDATE task_workbenches
      SET position = ${index}, updated_at_ms = ${now}
      WHERE workbench_id = '${escapeSqlLiteral(id)}' AND task_note_id = '${escapeSqlLiteral(normalizedTask)}'`);
  if (!statements.length) return;
  await runSqliteTransaction(dbPath, statements);
}

export async function deleteTaskWorkbench(dbPath: string, workbenchId: string): Promise<void> {
  const normalizedId = required(workbenchId, "Workbench ID");
  await runSqliteTransaction(dbPath, [
    `DELETE FROM task_workbench_sessions WHERE workbench_id = '${escapeSqlLiteral(normalizedId)}'`,
    `DELETE FROM task_workbenches WHERE workbench_id = '${escapeSqlLiteral(normalizedId)}'`
  ]);
}

/** Ensure a task always has at least one workbench, creating a default when empty. */
export async function ensureTaskWorkbench(
  dbPath: string,
  taskNoteId: string,
  options?: { name?: string; projectPath?: string | null }
): Promise<TaskWorkbench> {
  const existing = await listTaskWorkbenches(dbPath, taskNoteId);
  if (existing.length) return existing[0];
  return createTaskWorkbench(dbPath, { taskNoteId, ...options });
}

export async function listTaskWorkbenchSessionLinks(
  dbPath: string,
  workbenchId: string
): Promise<TaskWorkbenchSessionLink[]> {
  const rows = await runSqliteJson<TaskWorkbenchSessionRow>(
    dbPath,
    `SELECT workbench_id, provider, agent_session_id, updated_at_ms
     FROM task_workbench_sessions
     WHERE workbench_id = '${escapeSqlLiteral(workbenchId)}'
     ORDER BY updated_at_ms DESC;`
  );
  return rows.map((row) => ({
    workbenchId: row.workbench_id,
    provider: row.provider,
    agentSessionId: row.agent_session_id,
    updatedAtMs: Number(row.updated_at_ms) || 0
  }));
}

export async function assignSessionToTaskWorkbench(
  dbPath: string,
  workbenchId: string,
  provider: string,
  agentSessionId: string
): Promise<TaskWorkbenchSessionLink> {
  const normalizedWorkbench = required(workbenchId, "Workbench ID");
  const normalizedProvider = required(provider, "Session provider");
  const normalizedSession = required(agentSessionId, "Session ID");
  const now = Date.now();
  await runSqliteTransaction(dbPath, [`
    INSERT INTO task_workbench_sessions (workbench_id, provider, agent_session_id, updated_at_ms)
    VALUES ('${escapeSqlLiteral(normalizedWorkbench)}', '${escapeSqlLiteral(normalizedProvider)}',
            '${escapeSqlLiteral(normalizedSession)}', ${now})
    ON CONFLICT(workbench_id, provider, agent_session_id) DO UPDATE SET
      updated_at_ms = excluded.updated_at_ms
  `]);
  return {
    workbenchId: normalizedWorkbench,
    provider: normalizedProvider,
    agentSessionId: normalizedSession,
    updatedAtMs: now
  };
}

export async function removeSessionFromTaskWorkbench(
  dbPath: string,
  workbenchId: string,
  provider: string,
  agentSessionId: string
): Promise<void> {
  await runSqliteTransaction(dbPath, [`
    DELETE FROM task_workbench_sessions
    WHERE workbench_id = '${escapeSqlLiteral(workbenchId)}'
      AND provider = '${escapeSqlLiteral(provider)}'
      AND agent_session_id = '${escapeSqlLiteral(agentSessionId)}'
  `]);
}
