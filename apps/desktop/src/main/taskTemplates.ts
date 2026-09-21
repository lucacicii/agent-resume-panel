import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import {
  effectivePanelHome,
  ensureDesktopDbSchema,
  escapeSqlLiteral,
  loadSettings,
  runSqlite,
  runSqliteJson
} from "@agent-resume/core";
import { loadPanelDbPaths } from "./panelDatabases";
import {
  isTaskColorKey,
  isCustomHexColor,
  normalizeCustomHexColor,
  type TaskAccentSource,
  type TaskColorKey,
  type TaskCustomColor
} from "../shared/taskColors";

/**
 * Reusable task templates for the GTD board.
 *
 * A template is a starting point — a title, the projects it references, and
 * its accent (a fixed-palette key or an image-derived custom color) — that is
 * dragged onto a column to create a pre-filled task. Desktop private, so it
 * lives in `desktop.db` rather than the shared catalog. The task → template
 * link lives here too: it snapshots the template accent at creation so
 * deleting the template keeps the task's accent.
 *
 * An uploaded image is persisted as a normalized PNG under
 * `panelHome/templates/<templateId>.png` together with the candidate colors
 * extracted from it, so re-editing a template can offer the same candidates
 * without re-decoding. Deleting the template deletes its image file.
 */
export type TaskTemplate = {
  templateId: string;
  title: string;
  /** Projects the created task should reference, in priority order. */
  projectPaths: string[];
  /** Fixed-palette accent color; omitted when the template has none. */
  colorKey?: TaskColorKey;
  /** Image-derived accent color (`#rrggbb`); mutually exclusive with colorKey. */
  customColor?: TaskCustomColor;
  /** Candidate colors extracted from the uploaded image, first is recommended. */
  imageColors?: TaskCustomColor[];
  /** The persisted image as a base64 `data:image/png` URL; absent when none. */
  imageDataUrl?: string;
  createdAtMs: number;
  updatedAtMs: number;
};

/** A template image to persist: PNG bytes plus the colors extracted from it. */
export type TaskTemplateImageInput = {
  pngBase64: string;
  colors: TaskCustomColor[];
};

interface TaskTemplateRow {
  template_id: string;
  title: string;
  project_paths_json: string | null;
  color_key: string | null;
  custom_color: string | null;
  image_colors_json: string | null;
  image_path: string | null;
  created_at_ms: number;
  updated_at_ms: number;
}

interface TaskTemplateLinkRow {
  note_id: string;
  snapshot_color: string | null;
  live_color: string | null;
  snapshot_custom: string | null;
  live_custom: string | null;
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

function parseImageColors(raw: string | null): TaskCustomColor[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter(isCustomHexColor).slice(0, 12);
  } catch {
    return [];
  }
}

/** Where a template's image lives, relative to panelHome. */
function templateImagePath(templateId: string): string {
  return path.join("templates", `${templateId}.png`);
}

async function panelHomeRoot(): Promise<string> {
  return effectivePanelHome(await loadSettings());
}

function mapRow(row: TaskTemplateRow, options?: { imageDataUrl?: string }): TaskTemplate {
  const imageColors = parseImageColors(row.image_colors_json);
  return {
    templateId: row.template_id,
    title: row.title,
    projectPaths: parseProjectPaths(row.project_paths_json),
    colorKey: isTaskColorKey(row.color_key) ? row.color_key : undefined,
    customColor: normalizeCustomHexColor(row.custom_color),
    ...(imageColors.length > 0 ? { imageColors } : {}),
    ...(options?.imageDataUrl ? { imageDataUrl: options.imageDataUrl } : {}),
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

/** Normalize the mutually exclusive accent pair; a custom color wins. */
function normalizeAccent(args: {
  colorKey?: TaskColorKey | null;
  customColor?: TaskCustomColor | null;
}): { colorKey?: TaskColorKey; customColor?: TaskCustomColor } {
  const customColor = normalizeCustomHexColor(args.customColor);
  if (customColor) return { customColor };
  return { colorKey: isTaskColorKey(args.colorKey) ? args.colorKey : undefined };
}

/** Resolve `desktop.db` and make sure the template table exists. */
async function openTemplateDb(): Promise<string> {
  const paths = await loadPanelDbPaths(await loadSettings());
  await ensureDesktopDbSchema(paths.desktopDb);
  return paths.desktopDb;
}

const SELECT_COLUMNS =
  "template_id, title, project_paths_json, color_key, custom_color, image_colors_json, image_path, created_at_ms, updated_at_ms";

/** Read the persisted image as a data URL; absent when missing or unreadable. */
async function readImageDataUrl(relPath: string | null): Promise<string | undefined> {
  if (!relPath) return undefined;
  try {
    const bytes = await fs.readFile(path.join(await panelHomeRoot(), relPath));
    return `data:image/png;base64,${bytes.toString("base64")}`;
  } catch {
    return undefined;
  }
}

/** Write (or overwrite) the template image; returns the relative path. */
async function writeTemplateImage(templateId: string, image: TaskTemplateImageInput): Promise<string> {
  const rel = templateImagePath(templateId);
  const dest = path.join(await panelHomeRoot(), rel);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, Buffer.from(image.pngBase64, "base64"));
  return rel;
}

/** Delete the template image file; missing files are fine. */
async function deleteTemplateImage(relPath: string | null): Promise<void> {
  if (!relPath) return;
  await fs.rm(path.join(await panelHomeRoot(), relPath), { force: true }).catch(() => undefined);
}

export async function listTaskTemplates(): Promise<TaskTemplate[]> {
  const dbPath = await openTemplateDb();
  const panelHome = await panelHomeRoot();
  const rows = await runSqliteJson<TaskTemplateRow>(
    dbPath,
    `SELECT ${SELECT_COLUMNS} FROM task_templates ORDER BY updated_at_ms DESC;`
  );
  const out: TaskTemplate[] = [];
  for (const row of rows) {
    // The image read is best-effort per row; a missing file must not hide templates.
    let imageDataUrl: string | undefined;
    if (row.image_path) {
      try {
        imageDataUrl = `data:image/png;base64,${(await fs.readFile(path.join(panelHome, row.image_path))).toString("base64")}`;
      } catch {
        imageDataUrl = undefined;
      }
    }
    out.push(mapRow(row, { imageDataUrl }));
  }
  return out;
}

export async function createTaskTemplate(args: {
  title: string;
  projectPaths?: string[];
  colorKey?: TaskColorKey | null;
  customColor?: TaskCustomColor | null;
  image?: TaskTemplateImageInput | null;
}): Promise<TaskTemplate> {
  const dbPath = await openTemplateDb();
  const nowMs = Date.now();
  const title = args.title.trim();
  const projectPaths = normalizeProjectPaths(args.projectPaths);
  const accent = normalizeAccent(args);
  const template: TaskTemplate = {
    templateId: randomUUID(),
    title,
    projectPaths,
    createdAtMs: nowMs,
    updatedAtMs: nowMs
  };
  if (accent.colorKey) template.colorKey = accent.colorKey;
  if (accent.customColor) template.customColor = accent.customColor;
  if (args.image && args.image.colors.length > 0) {
    template.imageColors = args.image.colors.slice(0, 12);
    template.imageDataUrl = `data:image/png;base64,${args.image.pngBase64}`;
  }
  const imagePath = args.image && args.image.colors.length > 0
    ? await writeTemplateImage(template.templateId, args.image)
    : null;
  await runSqlite(
    dbPath,
    `INSERT INTO task_templates (template_id, title, project_paths_json, color_key, custom_color, image_colors_json, image_path, created_at_ms, updated_at_ms)
     VALUES (
       '${escapeSqlLiteral(template.templateId)}',
       '${escapeSqlLiteral(title)}',
       ${sqlNullable(projectPaths.length ? JSON.stringify(projectPaths) : undefined)},
       ${sqlNullable(accent.colorKey)},
       ${sqlNullable(accent.customColor)},
       ${sqlNullable(template.imageColors ? JSON.stringify(template.imageColors) : undefined)},
       ${sqlNullable(imagePath ?? undefined)},
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
  /** The template's next palette key; null clears it (updates always set the accent). */
  colorKey?: TaskColorKey | null;
  /** The template's next custom color; a value clears the palette key. */
  customColor?: TaskCustomColor | null;
  /**
   * Image handling: an object replaces (or attaches) the image, null removes
   * the image and its candidates, undefined keeps the stored one untouched.
   */
  image?: TaskTemplateImageInput | null;
}): Promise<TaskTemplate> {
  const dbPath = await openTemplateDb();
  const nowMs = Date.now();
  const title = args.title.trim();
  const projectPaths = normalizeProjectPaths(args.projectPaths);
  const accent = normalizeAccent(args);

  const currentRows = await runSqliteJson<TaskTemplateRow>(
    dbPath,
    `SELECT ${SELECT_COLUMNS} FROM task_templates WHERE template_id = '${escapeSqlLiteral(args.templateId)}' LIMIT 1;`
  );
  const current = currentRows[0];
  if (!current) throw new Error("Task template not found.");

  let imagePath = current.image_path;
  let imageColorsJson = current.image_colors_json;
  if (args.image === null) {
    await deleteTemplateImage(current.image_path);
    imagePath = null;
    imageColorsJson = null;
  } else if (args.image && args.image.colors.length > 0) {
    imagePath = await writeTemplateImage(args.templateId, args.image);
    imageColorsJson = JSON.stringify(args.image.colors.slice(0, 12));
  }

  await runSqlite(
    dbPath,
    `UPDATE task_templates
     SET title = '${escapeSqlLiteral(title)}',
         project_paths_json = ${sqlNullable(projectPaths.length ? JSON.stringify(projectPaths) : undefined)},
         color_key = ${sqlNullable(accent.colorKey)},
         custom_color = ${sqlNullable(accent.customColor)},
         image_colors_json = ${sqlNullable(imageColorsJson ?? undefined)},
         image_path = ${sqlNullable(imagePath ?? undefined)},
         updated_at_ms = ${nowMs}
     WHERE template_id = '${escapeSqlLiteral(args.templateId)}';`
  );
  const rows = await runSqliteJson<TaskTemplateRow>(
    dbPath,
    `SELECT ${SELECT_COLUMNS} FROM task_templates WHERE template_id = '${escapeSqlLiteral(args.templateId)}' LIMIT 1;`
  );
  if (!rows[0]) throw new Error("Task template not found.");
  return mapRow(rows[0], { imageDataUrl: await readImageDataUrl(rows[0].image_path) });
}

export async function deleteTaskTemplate(templateId: string): Promise<{ ok: boolean }> {
  const dbPath = await openTemplateDb();
  const rows = await runSqliteJson<{ image_path: string | null }>(
    dbPath,
    `SELECT image_path FROM task_templates WHERE template_id = '${escapeSqlLiteral(templateId)}' LIMIT 1;`
  );
  await runSqlite(dbPath, `DELETE FROM task_templates WHERE template_id = '${escapeSqlLiteral(templateId)}';`);
  // Deleting the template deletes its image file.
  if (rows[0]?.image_path) await deleteTemplateImage(rows[0].image_path);
  return { ok: true };
}

/**
 * Record that a task was created from a template, snapshotting its accent.
 *
 * Returns the snapshotted accent source, or undefined when the template no
 * longer exists or carries no color — in both cases the task stays neutral.
 */
export async function linkTaskTemplate(args: {
  noteId: string;
  templateId: string;
}): Promise<TaskAccentSource | undefined> {
  const dbPath = await openTemplateDb();
  const rows = await runSqliteJson<TaskTemplateRow>(
    dbPath,
    `SELECT ${SELECT_COLUMNS} FROM task_templates WHERE template_id = '${escapeSqlLiteral(args.templateId)}' LIMIT 1;`
  );
  const template = rows[0];
  if (!template) return undefined;
  const colorKey = isTaskColorKey(template.color_key) ? template.color_key : undefined;
  const customColor = normalizeCustomHexColor(template.custom_color);
  const nowMs = Date.now();
  await runSqlite(
    dbPath,
    `INSERT INTO task_template_links (note_id, template_id, color_key, custom_color, created_at_ms, updated_at_ms)
     VALUES (
       '${escapeSqlLiteral(args.noteId)}',
       '${escapeSqlLiteral(args.templateId)}',
       ${sqlNullable(colorKey)},
       ${sqlNullable(customColor)},
       ${nowMs},
       ${nowMs}
     )
     ON CONFLICT(note_id) DO UPDATE SET
       template_id = excluded.template_id,
       color_key = excluded.color_key,
       custom_color = excluded.custom_color,
       updated_at_ms = excluded.updated_at_ms;`
  );
  if (colorKey) return { colorKey };
  if (customColor) return { customColor };
  return undefined;
}

/**
 * note_id → accent source for every linked task: the template's live accent
 * when it still exists, else the accent snapshotted at creation.
 */
export async function resolveTaskAccents(): Promise<Map<string, TaskAccentSource>> {
  const dbPath = await openTemplateDb();
  const rows = await runSqliteJson<TaskTemplateLinkRow>(
    dbPath,
    `SELECT links.note_id,
            links.color_key AS snapshot_color,
            templates.color_key AS live_color,
            links.custom_color AS snapshot_custom,
            templates.custom_color AS live_custom
     FROM task_template_links AS links
     LEFT JOIN task_templates AS templates ON templates.template_id = links.template_id;`
  );
  const out = new Map<string, TaskAccentSource>();
  for (const row of rows) {
    // Same precedence as writes: a custom color wins over a palette key, and
    // the template's live accent wins over the snapshot taken at creation.
    const liveCustom = normalizeCustomHexColor(row.live_custom);
    const liveKey = isTaskColorKey(row.live_color) ? row.live_color : undefined;
    const snapshotCustom = normalizeCustomHexColor(row.snapshot_custom);
    const snapshotKey = isTaskColorKey(row.snapshot_color) ? row.snapshot_color : undefined;
    const resolved: TaskAccentSource = liveCustom
      ? { customColor: liveCustom }
      : liveKey
        ? { colorKey: liveKey }
        : snapshotCustom
          ? { customColor: snapshotCustom }
          : snapshotKey
            ? { colorKey: snapshotKey }
            : {};
    if (resolved.colorKey || resolved.customColor) out.set(row.note_id, resolved);
  }
  return out;
}

/**
 * The scoped task's template image (as a data URL), resolved through its
 * template link — undefined when the task has no template or no image.
 */
export async function taskTemplateImageForNote(noteId: string): Promise<string | undefined> {
  const dbPath = await openTemplateDb();
  const rows = await runSqliteJson<{ image_path: string | null }>(
    dbPath,
    `SELECT templates.image_path AS image_path
     FROM task_template_links AS links
     LEFT JOIN task_templates AS templates ON templates.template_id = links.template_id
     WHERE links.note_id = '${escapeSqlLiteral(noteId)}' LIMIT 1;`
  );
  return readImageDataUrl(rows[0]?.image_path ?? null);
}

/** Drop a task's template link; called when the task note is deleted. */
export async function unlinkTaskTemplate(noteId: string): Promise<void> {
  const dbPath = await openTemplateDb();
  await runSqlite(dbPath, `DELETE FROM task_template_links WHERE note_id = '${escapeSqlLiteral(noteId)}';`);
}
