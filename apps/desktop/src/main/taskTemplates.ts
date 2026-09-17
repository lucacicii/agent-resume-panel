import { randomUUID } from "node:crypto";
import {
  ensureDesktopDbSchema,
  escapeSqlLiteral,
  loadSettings,
  runSqlite,
  runSqliteJson
} from "@agent-resume/core";
import { loadPanelDbPaths } from "./panelDatabases";

/**
 * Reusable task templates for the GTD board.
 *
 * A template is a starting point — a title and the projects it references —
 * that is dragged onto a column to create a pre-filled task. Desktop
 * private, so it lives in `desktop.db` rather than the shared catalog.
 */
export type TaskTemplate = {
  templateId: string;
  title: string;
  /** Projects the created task should reference, in priority order. */
  projectPaths: string[];
  createdAtMs: number;
  updatedAtMs: number;
};

interface TaskTemplateRow {
  template_id: string;
  title: string;
  project_paths_json: string | null;
  created_at_ms: number;
  updated_at_ms: number;
}

function parseProjectPaths(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  } catch {
    return [];
  }
}

function mapRow(row: TaskTemplateRow): TaskTemplate {
  return {
    templateId: row.template_id,
    title: row.title,
    projectPaths: parseProjectPaths(row.project_paths_json),
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms
  };
}

/** Trim, drop empties, and de-duplicate while preserving order. */
function normalizeProjectPaths(paths: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of paths ?? []) {
    const value = entry.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function sqlNullable(value: string | undefined): string {
  return value ? `'${escapeSqlLiteral(value)}'` : "NULL";
}

/** Resolve `desktop.db` and make sure the template table exists. */
async function openTemplateDb(): Promise<string> {
  const paths = await loadPanelDbPaths(await loadSettings());
  await ensureDesktopDbSchema(paths.desktopDb);
  return paths.desktopDb;
}

const SELECT_COLUMNS = "template_id, title, project_paths_json, created_at_ms, updated_at_ms";

export async function listTaskTemplates(): Promise<TaskTemplate[]> {
  const dbPath = await openTemplateDb();
  const rows = await runSqliteJson<TaskTemplateRow>(
    dbPath,
    `SELECT ${SELECT_COLUMNS} FROM task_templates ORDER BY updated_at_ms DESC;`
  );
  return rows.map(mapRow);
}

export async function createTaskTemplate(args: { title: string; projectPaths?: string[] }): Promise<TaskTemplate> {
  const dbPath = await openTemplateDb();
  const nowMs = Date.now();
  const title = args.title.trim();
  const projectPaths = normalizeProjectPaths(args.projectPaths);
  const template: TaskTemplate = {
    templateId: randomUUID(),
    title,
    projectPaths,
    createdAtMs: nowMs,
    updatedAtMs: nowMs
  };
  await runSqlite(
    dbPath,
    `INSERT INTO task_templates (template_id, title, project_paths_json, created_at_ms, updated_at_ms)
     VALUES (
       '${escapeSqlLiteral(template.templateId)}',
       '${escapeSqlLiteral(title)}',
       ${sqlNullable(projectPaths.length ? JSON.stringify(projectPaths) : undefined)},
       ${nowMs},
       ${nowMs}
     );`
  );
  return template;
}

export async function updateTaskTemplate(args: {
  templateId: string;
  title: string;
  projectPaths?: string[];
}): Promise<TaskTemplate> {
  const dbPath = await openTemplateDb();
  const nowMs = Date.now();
  const title = args.title.trim();
  const projectPaths = normalizeProjectPaths(args.projectPaths);
  await runSqlite(
    dbPath,
    `UPDATE task_templates
     SET title = '${escapeSqlLiteral(title)}',
         project_paths_json = ${sqlNullable(projectPaths.length ? JSON.stringify(projectPaths) : undefined)},
         updated_at_ms = ${nowMs}
     WHERE template_id = '${escapeSqlLiteral(args.templateId)}';`
  );
  const rows = await runSqliteJson<TaskTemplateRow>(
    dbPath,
    `SELECT ${SELECT_COLUMNS} FROM task_templates WHERE template_id = '${escapeSqlLiteral(args.templateId)}' LIMIT 1;`
  );
  if (!rows[0]) throw new Error("Task template not found.");
  return mapRow(rows[0]);
}

export async function deleteTaskTemplate(templateId: string): Promise<{ ok: boolean }> {
  const dbPath = await openTemplateDb();
  await runSqlite(dbPath, `DELETE FROM task_templates WHERE template_id = '${escapeSqlLiteral(templateId)}';`);
  return { ok: true };
}
