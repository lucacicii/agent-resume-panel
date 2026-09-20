import { randomUUID } from "node:crypto";
import {
  ensureDesktopDbSchema,
  escapeSqlLiteral,
  loadSettings,
  runSqlite,
  runSqliteJson
} from "@agent-resume/core";
import { loadPanelDbPaths } from "./panelDatabases";
import { isTaskColorKey, type TaskColorKey } from "../shared/taskColors";

/**
 * Reusable task templates for the GTD board.
 *
 * A template is a starting point — a title, the projects it references, and
 * its accent color key — that is dragged onto a column to create a pre-filled
 * task. Desktop private, so it lives in `desktop.db` rather than the shared
 * catalog. The task → template link lives here too: it snapshots the template
 * color at creation so deleting the template keeps the task's accent.
 */
export type TaskTemplate = {
  templateId: string;
  title: string;
  /** Projects the created task should reference, in priority order. */
  projectPaths: string[];
  /** Fixed-palette accent color; omitted when the template has none. */
  colorKey?: TaskColorKey;
  createdAtMs: number;
  updatedAtMs: number;
};

interface TaskTemplateRow {
  template_id: string;
  title: string;
  project_paths_json: string | null;
  color_key: string | null;
  created_at_ms: number;
  updated_at_ms: number;
}

interface TaskTemplateLinkRow {
  note_id: string;
  snapshot_color: string | null;
  live_color: string | null;
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
    colorKey: isTaskColorKey(row.color_key) ? row.color_key : undefined,
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

const SELECT_COLUMNS = "template_id, title, project_paths_json, color_key, created_at_ms, updated_at_ms";

export async function listTaskTemplates(): Promise<TaskTemplate[]> {
  const dbPath = await openTemplateDb();
  const rows = await runSqliteJson<TaskTemplateRow>(
    dbPath,
    `SELECT ${SELECT_COLUMNS} FROM task_templates ORDER BY updated_at_ms DESC;`
  );
  return rows.map(mapRow);
}

export async function createTaskTemplate(args: {
  title: string;
  projectPaths?: string[];
  colorKey?: TaskColorKey;
}): Promise<TaskTemplate> {
  const dbPath = await openTemplateDb();
  const nowMs = Date.now();
  const title = args.title.trim();
  const projectPaths = normalizeProjectPaths(args.projectPaths);
  const template: TaskTemplate = {
    templateId: randomUUID(),
    title,
    projectPaths,
    colorKey: args.colorKey,
    createdAtMs: nowMs,
    updatedAtMs: nowMs
  };
  await runSqlite(
    dbPath,
    `INSERT INTO task_templates (template_id, title, project_paths_json, color_key, created_at_ms, updated_at_ms)
     VALUES (
       '${escapeSqlLiteral(template.templateId)}',
       '${escapeSqlLiteral(title)}',
       ${sqlNullable(projectPaths.length ? JSON.stringify(projectPaths) : undefined)},
       ${sqlNullable(template.colorKey)},
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
  /** The template's next color; null clears it (updates always set the color). */
  colorKey?: TaskColorKey | null;
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
         color_key = ${args.colorKey ? `'${escapeSqlLiteral(args.colorKey)}'` : "NULL"},
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

/**
 * Record that a task was created from a template, snapshotting its color.
 *
 * Returns the snapshotted color key, or undefined when the template no longer
 * exists or carries no color — in both cases the task stays neutral.
 */
export async function linkTaskTemplate(args: {
  noteId: string;
  templateId: string;
}): Promise<TaskColorKey | undefined> {
  const dbPath = await openTemplateDb();
  const rows = await runSqliteJson<TaskTemplateRow>(
    dbPath,
    `SELECT ${SELECT_COLUMNS} FROM task_templates WHERE template_id = '${escapeSqlLiteral(args.templateId)}' LIMIT 1;`
  );
  const template = rows[0];
  if (!template) return undefined;
  const nowMs = Date.now();
  await runSqlite(
    dbPath,
    `INSERT INTO task_template_links (note_id, template_id, color_key, created_at_ms, updated_at_ms)
     VALUES (
       '${escapeSqlLiteral(args.noteId)}',
       '${escapeSqlLiteral(args.templateId)}',
       ${sqlNullable(template.color_key ?? undefined)},
       ${nowMs},
       ${nowMs}
     )
     ON CONFLICT(note_id) DO UPDATE SET
       template_id = excluded.template_id,
       color_key = excluded.color_key,
       updated_at_ms = excluded.updated_at_ms;`
  );
  return isTaskColorKey(template.color_key) ? template.color_key : undefined;
}

/**
 * note_id → color key for every linked task: the template's live color when it
 * still exists, else the color snapshotted at creation.
 */
export async function resolveTaskColorKeys(): Promise<Map<string, TaskColorKey>> {
  const dbPath = await openTemplateDb();
  const rows = await runSqliteJson<TaskTemplateLinkRow>(
    dbPath,
    `SELECT links.note_id, links.color_key AS snapshot_color, templates.color_key AS live_color
     FROM task_template_links AS links
     LEFT JOIN task_templates AS templates ON templates.template_id = links.template_id;`
  );
  const out = new Map<string, TaskColorKey>();
  for (const row of rows) {
    const resolved = isTaskColorKey(row.live_color)
      ? row.live_color
      : isTaskColorKey(row.snapshot_color)
        ? row.snapshot_color
        : undefined;
    if (resolved) out.set(row.note_id, resolved);
  }
  return out;
}

/** Drop a task's template link; called when the task note is deleted. */
export async function unlinkTaskTemplate(noteId: string): Promise<void> {
  const dbPath = await openTemplateDb();
  await runSqlite(dbPath, `DELETE FROM task_template_links WHERE note_id = '${escapeSqlLiteral(noteId)}';`);
}
