import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import {
  expandHome,
  expandPortableKey,
  normalizeProjectPath,
  toPortableKey
} from "../pathUtils";
import { getMachineId } from "../machineId";
import { escapeSqlLiteral, runSqlite, runSqliteJson } from "../sqlite";

export interface ProjectRow {
  projectId: string;
  portableKey: string;
  alias: string;
  hidden: boolean;
  pinned: boolean;
  lastSeenAtMs: number | null;
  updatedAtMs: number;
  /** Resolved absolute path on this machine when known / derivable. */
  localPath: string | null;
  pathMissing: boolean;
  sessionCount: number;
}

export interface ResolveProjectCwdResult {
  cwd: string;
  source: "local" | "portable" | "rehome" | "missing";
  projectId: string;
  portableKey: string;
}

interface ProjectSqlRow {
  project_id: string;
  portable_key: string;
  alias: string;
  hidden: number;
  pinned?: number | null;
  last_seen_at_ms: number | null;
  updated_at_ms: number;
  /** JSON array of portable keys absorbed into this project by merge. */
  absorbed_keys?: string | null;
}

const PROJECTS_CREATE_SQL = `CREATE TABLE projects (
  project_id TEXT PRIMARY KEY,
  portable_key TEXT NOT NULL UNIQUE,
  alias TEXT NOT NULL DEFAULT '',
  hidden INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  last_seen_at_ms INTEGER,
  updated_at_ms INTEGER NOT NULL,
  absorbed_keys TEXT
);`;

async function ensureProjectsAdditiveColumns(dbPath: string): Promise<void> {
  for (const stmt of [
    `ALTER TABLE projects ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE projects ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE projects ADD COLUMN last_seen_at_ms INTEGER`,
    `ALTER TABLE projects ADD COLUMN alias TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE projects ADD COLUMN absorbed_keys TEXT`
  ]) {
    try {
      await runSqlite(dbPath, `${stmt};`);
    } catch {
      // duplicate / incompatible — ignore
    }
  }
}

interface LocalPathSqlRow {
  project_id: string;
  machine_id: string;
  absolute_path: string;
  updated_at_ms: number;
}

let projectsSchemaReady = new Set<string>();

async function tableColumns(dbPath: string, table: string): Promise<Set<string>> {
  const rows = await runSqliteJson<{ name: string }>(dbPath, `PRAGMA table_info(${table});`);
  return new Set(rows.map((row) => row.name));
}

async function tableExists(dbPath: string, table: string): Promise<boolean> {
  const rows = await runSqliteJson(
    dbPath,
    `SELECT name FROM sqlite_master WHERE type='table' AND name='${escapeSqlLiteral(table)}';`
  );
  return rows.length > 0;
}

/**
 * Ensure first-class projects schema + one-time migration from legacy
 * `projects(project_path, alias, updated_at_ms)`.
 */
export async function ensureProjectsCatalogSchema(dbPath: string): Promise<void> {
  await runSqlite(
    dbPath,
    `CREATE TABLE IF NOT EXISTS project_local_paths (
      project_id TEXT NOT NULL,
      machine_id TEXT NOT NULL,
      absolute_path TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      PRIMARY KEY (project_id, machine_id)
    );
    CREATE INDEX IF NOT EXISTS idx_project_local_paths_path ON project_local_paths(absolute_path);`
  );

  try {
    await runSqlite(dbPath, `ALTER TABLE sessions ADD COLUMN project_id TEXT;`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("duplicate column name")) {
      // table may not exist yet on empty ensure order — ignore
      if (!message.includes("no such table")) {
        throw error;
      }
    }
  }

  try {
    await runSqlite(dbPath, `CREATE INDEX IF NOT EXISTS idx_sessions_project_id ON sessions(project_id);`);
  } catch {
    // ignore
  }

  try {
    await runSqlite(dbPath, `ALTER TABLE sessions ADD COLUMN native_project_path TEXT;`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("duplicate column name") && !message.includes("no such table")) {
      throw error;
    }
  }

  // One-time backfill: existing rows start "tracking native" so the value rule
  // (project_path == native_project_path ⇒ follow native) keeps current behavior.
  try {
    await runSqlite(
      dbPath,
      `UPDATE sessions SET native_project_path = project_path
       WHERE native_project_path IS NULL AND project_path IS NOT NULL AND TRIM(project_path) != '';`
    );
  } catch {
    // native_project_path may not exist yet on empty ensure order — ignore
  }

  if (projectsSchemaReady.has(dbPath)) {
    // Still apply additive columns for rolling upgrades within a process lifetime.
    if (await tableExists(dbPath, "projects")) {
      await ensureProjectsAdditiveColumns(dbPath);
    }
    return;
  }

  const hasProjects = await tableExists(dbPath, "projects");
  if (!hasProjects) {
    await runSqlite(dbPath, PROJECTS_CREATE_SQL);
    projectsSchemaReady.add(dbPath);
    return;
  }

  const cols = await tableColumns(dbPath, "projects");
  if (cols.has("project_id") && cols.has("portable_key")) {
    await ensureProjectsAdditiveColumns(dbPath);
    projectsSchemaReady.add(dbPath);
    return;
  }

  // Legacy: project_path PK → rebuild
  const legacyRows = await runSqliteJson<{
    project_path: string;
    alias: string;
    updated_at_ms: number;
  }>(dbPath, `SELECT project_path, alias, updated_at_ms FROM projects;`);

  await runSqlite(
    dbPath,
    `ALTER TABLE projects RENAME TO projects_legacy_path;
     ${PROJECTS_CREATE_SQL}`
  );

  const machineId = await getMachineId();
  const now = Date.now();
  const byKey = new Map<
    string,
    { projectId: string; alias: string; updatedAtMs: number; paths: string[] }
  >();

  for (const row of legacyRows) {
    const absolute = normalizeProjectPath(row.project_path);
    const key = toPortableKey(absolute);
    const existing = byKey.get(key);
    const alias = (row.alias || "").trim();
    if (!existing) {
      byKey.set(key, {
        projectId: randomUUID(),
        alias,
        updatedAtMs: Number(row.updated_at_ms) || now,
        paths: [absolute]
      });
      continue;
    }
    if (alias && (!existing.alias || Number(row.updated_at_ms) >= existing.updatedAtMs)) {
      existing.alias = alias;
      existing.updatedAtMs = Number(row.updated_at_ms) || existing.updatedAtMs;
    }
    if (!existing.paths.includes(absolute)) {
      existing.paths.push(absolute);
    }
  }

  const statements: string[] = [];
  for (const [key, value] of byKey) {
    statements.push(
      `INSERT INTO projects (project_id, portable_key, alias, hidden, pinned, last_seen_at_ms, updated_at_ms)
       VALUES ('${escapeSqlLiteral(value.projectId)}', '${escapeSqlLiteral(key)}', '${escapeSqlLiteral(value.alias)}', 0, 0, NULL, ${value.updatedAtMs});`
    );
    for (const absolute of value.paths) {
      statements.push(
        `INSERT OR IGNORE INTO project_local_paths (project_id, machine_id, absolute_path, updated_at_ms)
         VALUES ('${escapeSqlLiteral(value.projectId)}', '${escapeSqlLiteral(machineId)}', '${escapeSqlLiteral(absolute)}', ${now});`
      );
    }
  }

  if (statements.length) {
    await runSqlite(dbPath, `BEGIN;\n${statements.join("\n")}\nCOMMIT;`);
  }

  await runSqlite(dbPath, `DROP TABLE IF EXISTS projects_legacy_path;`);
  projectsSchemaReady.add(dbPath);
}

function newProjectId(): string {
  return randomUUID();
}

/** Parse the JSON-array absorbed_keys column; tolerant of legacy/NULL values. */
function parseAbsorbedKeys(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : [];
  } catch {
    return [];
  }
}

async function upsertLocalPath(
  dbPath: string,
  projectId: string,
  machineId: string,
  absolutePath: string,
  nowMs: number
): Promise<void> {
  const absolute = normalizeProjectPath(absolutePath);
  await runSqlite(
    dbPath,
    `INSERT INTO project_local_paths (project_id, machine_id, absolute_path, updated_at_ms)
     VALUES ('${escapeSqlLiteral(projectId)}', '${escapeSqlLiteral(machineId)}', '${escapeSqlLiteral(absolute)}', ${nowMs})
     ON CONFLICT(project_id, machine_id) DO UPDATE SET
       absolute_path = excluded.absolute_path,
       updated_at_ms = excluded.updated_at_ms;`
  );
}

async function findProjectByPortableKey(
  dbPath: string,
  portableKey: string
): Promise<ProjectSqlRow | undefined> {
  const rows = await runSqliteJson<ProjectSqlRow>(
    dbPath,
    `SELECT project_id, portable_key, alias, hidden, pinned, last_seen_at_ms, updated_at_ms, absorbed_keys
     FROM projects WHERE portable_key = '${escapeSqlLiteral(portableKey)}' LIMIT 1;`
  );
  return rows[0];
}

async function findProjectById(dbPath: string, projectId: string): Promise<ProjectSqlRow | undefined> {
  const rows = await runSqliteJson<ProjectSqlRow>(
    dbPath,
    `SELECT project_id, portable_key, alias, hidden, pinned, last_seen_at_ms, updated_at_ms, absorbed_keys
     FROM projects WHERE project_id = '${escapeSqlLiteral(projectId)}' LIMIT 1;`
  );
  return rows[0];
}

async function findProjectIdForAbsolutePath(dbPath: string, absolutePath: string): Promise<string | undefined> {
  const absolute = normalizeProjectPath(absolutePath);
  const byPath = await runSqliteJson<{ project_id: string }>(
    dbPath,
    `SELECT project_id FROM project_local_paths
     WHERE absolute_path = '${escapeSqlLiteral(absolute)}' LIMIT 1;`
  );
  if (byPath[0]?.project_id) {
    return byPath[0].project_id;
  }
  const key = toPortableKey(absolute);
  const byKey = await findProjectByPortableKey(dbPath, key);
  return byKey?.project_id;
}

/**
 * Find a project that absorbed this portable key via a merge. Merged-away
 * paths must keep resolving to the absorbing target so the periodic reconcile
 * does not re-create the deleted source project and pull sessions back out.
 */
async function findAbsorberProjectId(dbPath: string, portableKey: string): Promise<string | undefined> {
  const rows = await runSqliteJson<{ project_id: string }>(
    dbPath,
    `SELECT project_id FROM projects
     WHERE absorbed_keys IS NOT NULL AND absorbed_keys != ''
       AND EXISTS (
         SELECT 1 FROM json_each(projects.absorbed_keys)
         WHERE json_each.value = '${escapeSqlLiteral(portableKey)}'
       )
     LIMIT 1;`
  );
  return rows[0]?.project_id;
}

/**
 * Ensure a logical project exists for an absolute path; optionally bind this machine's local path.
 * Returns project_id.
 *
 * Local-path binding rules (one primary path per project per machine):
 * - New project: bind this path (it is the portable identity).
 * - Path matches the project's portable_key: refresh the primary binding.
 * - bindLocalPath: true: force bind (caller intent).
 * - Absorbed / non-canonical paths that only resolve via owner or absorbed_keys:
 *   link to the project but do **not** overwrite the primary local path.
 *   Otherwise periodic reconcile after merge rewrites the cwd to a subfolder
 *   (e.g. packages/core) and "Set local folder" never sticks.
 */
export async function ensureProjectForPath(
  dbPath: string,
  projectPath: string,
  options?: { machineId?: string; touchSeen?: boolean; bindLocalPath?: boolean }
): Promise<string> {
  await ensureProjectsCatalogSchema(dbPath);
  const absolute = normalizeProjectPath(expandHome(projectPath.trim() || ""));
  const portableKey = toPortableKey(absolute);
  const machineId = options?.machineId || (await getMachineId());
  const now = Date.now();

  let row = await findProjectByPortableKey(dbPath, portableKey);
  if (!row) {
    // A path already bound to a project as a local path resolves to that owner.
    // After a merge the source path becomes a local path of the target, so the
    // next reconcile must resolve it back to the target instead of re-creating
    // the merged-away project (which would pull the merged sessions out again).
    const ownerId = await findProjectIdForAbsolutePath(dbPath, absolute);
    if (ownerId) {
      row = await findProjectById(dbPath, ownerId);
    }
  }
  if (!row) {
    // Path absorbed by an earlier merge still belongs to the absorbing project,
    // even after later merges overwrite the local-path binding on this machine.
    const absorberId = await findAbsorberProjectId(dbPath, portableKey);
    if (absorberId) {
      row = await findProjectById(dbPath, absorberId);
    }
  }
  let created = false;
  if (!row) {
    const projectId = newProjectId();
    await runSqlite(
      dbPath,
      `INSERT INTO projects (project_id, portable_key, alias, hidden, pinned, last_seen_at_ms, updated_at_ms)
       VALUES ('${escapeSqlLiteral(projectId)}', '${escapeSqlLiteral(portableKey)}', '', 0, 0, ${now}, ${now});`
    );
    row = {
      project_id: projectId,
      portable_key: portableKey,
      alias: "",
      hidden: 0,
      pinned: 0,
      last_seen_at_ms: now,
      updated_at_ms: now
    };
    created = true;
  } else if (options?.touchSeen !== false) {
    await runSqlite(
      dbPath,
      `UPDATE projects SET last_seen_at_ms = ${now} WHERE project_id = '${escapeSqlLiteral(row.project_id)}';`
    );
  }

  const isCanonical = portableKey === row.portable_key;
  const shouldBind = options?.bindLocalPath === true || created || isCanonical;
  if (shouldBind) {
    await upsertLocalPath(dbPath, row.project_id, machineId, absolute, now);
  }
  return row.project_id;
}

/**
 * Reconcile projects from sessions (+ optional note paths): merge by portable_key,
 * attach project_id on sessions, unhide project when any visible session exists.
 */
export async function reconcileProjectsFromSessions(
  dbPath: string,
  options?: { machineId?: string }
): Promise<{ projectCount: number; linkedSessions: number }> {
  await ensureProjectsCatalogSchema(dbPath);
  const machineId = options?.machineId || (await getMachineId());
  const now = Date.now();

  const sessionPaths = await runSqliteJson<{
    project_path: string;
    hidden: number;
    cnt: number;
  }>(
    dbPath,
    `SELECT project_path, hidden, COUNT(*) AS cnt
     FROM sessions
     WHERE project_path IS NOT NULL AND TRIM(project_path) != ''
     GROUP BY project_path, hidden;`
  );

  const notePaths = await runSqliteJson<{ project_path: string }>(
    dbPath,
    `SELECT DISTINCT project_path FROM notes
     WHERE project_path IS NOT NULL AND TRIM(project_path) != ''
       AND scope = 'project';`
  ).catch(() => [] as Array<{ project_path: string }>);

  const pathStats = new Map<string, { visible: number; total: number }>();
  for (const row of sessionPaths) {
    const absolute = normalizeProjectPath(row.project_path);
    const stat = pathStats.get(absolute) || { visible: 0, total: 0 };
    const count = Number(row.cnt) || 0;
    stat.total += count;
    if (!row.hidden) {
      stat.visible += count;
    }
    pathStats.set(absolute, stat);
  }
  for (const row of notePaths) {
    const absolute = normalizeProjectPath(row.project_path);
    if (!pathStats.has(absolute)) {
      pathStats.set(absolute, { visible: 0, total: 0 });
    }
  }

  let linkedSessions = 0;
  const visibleByProject = new Map<string, number>();

  for (const [absolute, stat] of pathStats) {
    const projectId = await ensureProjectForPath(dbPath, absolute, { machineId, touchSeen: true });
    visibleByProject.set(projectId, (visibleByProject.get(projectId) || 0) + stat.visible);

    const result = await runSqliteJson<{ changes: number }>(
      dbPath,
      `UPDATE sessions SET project_id = '${escapeSqlLiteral(projectId)}'
       WHERE project_path = '${escapeSqlLiteral(absolute)}';
       SELECT changes() AS changes;`
    );
    linkedSessions += Number(result[0]?.changes) || 0;

    // Link any non-normalized path strings that share this portable key
    const rawMatches = sessionPaths.filter(
      (row) => toPortableKey(row.project_path) === toPortableKey(absolute)
    );
    for (const raw of rawMatches) {
      if (normalizeProjectPath(raw.project_path) === absolute) continue;
      const extra = await runSqliteJson<{ changes: number }>(
        dbPath,
        `UPDATE sessions SET project_id = '${escapeSqlLiteral(projectId)}'
         WHERE project_path = '${escapeSqlLiteral(raw.project_path)}';
         SELECT changes() AS changes;`
      );
      linkedSessions += Number(extra[0]?.changes) || 0;
    }
  }

  // Link any remaining sessions by portable key of their project_path
  const unlinked = await runSqliteJson<{ provider: string; agent_session_id: string; project_path: string }>(
    dbPath,
    `SELECT provider, agent_session_id, project_path FROM sessions
     WHERE project_id IS NULL OR TRIM(project_id) = '';`
  );
  for (const row of unlinked) {
    if (!row.project_path?.trim()) continue;
    const projectId = await ensureProjectForPath(dbPath, row.project_path, { machineId, touchSeen: true });
    await runSqlite(
      dbPath,
      `UPDATE sessions SET project_id = '${escapeSqlLiteral(projectId)}'
       WHERE provider = '${escapeSqlLiteral(row.provider)}'
         AND agent_session_id = '${escapeSqlLiteral(row.agent_session_id)}';`
    );
    linkedSessions += 1;
  }

  // Unhide projects that have visible sessions (new session re-shows project)
  for (const [projectId, visible] of visibleByProject) {
    if (visible > 0) {
      await runSqlite(
        dbPath,
        `UPDATE projects SET hidden = 0, last_seen_at_ms = ${now}
         WHERE project_id = '${escapeSqlLiteral(projectId)}' AND hidden = 1;`
      );
    }
  }

  const countRows = await runSqliteJson<{ c: number }>(dbPath, `SELECT COUNT(*) AS c FROM projects;`);
  return { projectCount: Number(countRows[0]?.c) || 0, linkedSessions };
}

async function isDirectory(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Find an existing on-disk directory for a project.
 * Order matches product rules: machine local → portable expand → rehome other machines.
 * On success, upserts this machine's local_paths row when needed.
 */
async function resolveExistingLocalPath(
  dbPath: string,
  projectId: string,
  portableKey: string,
  locals: LocalPathSqlRow[],
  options?: { persist?: boolean }
): Promise<{ path: string; source: ResolveProjectCwdResult["source"] }> {
  const machineId = await getMachineId();
  const persist = options?.persist !== false;
  const now = Date.now();

  const localRow = locals.find((row) => row.machine_id === machineId);
  if (localRow?.absolute_path) {
    const candidate = normalizeProjectPath(expandHome(localRow.absolute_path));
    if (await isDirectory(candidate)) {
      if (persist && candidate !== localRow.absolute_path) {
        await upsertLocalPath(dbPath, projectId, machineId, candidate, now);
      }
      return { path: candidate, source: "local" };
    }
  }

  const fromPortable = expandPortableKey(portableKey);
  if (fromPortable && (await isDirectory(fromPortable))) {
    if (persist) {
      await upsertLocalPath(dbPath, projectId, machineId, fromPortable, now);
    }
    return { path: fromPortable, source: "portable" };
  }

  // Stale local path may block portable above when local existed but was wrong —
  // portable already tried. Also try rehoming EVERY stored path (including this machine's stale row).
  for (const row of locals) {
    const rehomed = expandHome(row.absolute_path);
    if (!rehomed || !(await isDirectory(rehomed))) continue;
    if (persist) {
      await upsertLocalPath(dbPath, projectId, machineId, rehomed, now);
    }
    return {
      path: rehomed,
      source: row.machine_id === machineId ? "local" : "rehome"
    };
  }

  // Session paths for this project (may not be in local_paths yet).
  // Prefer paths that match the project's portable identity so a merge that
  // absorbed subfolder sessions (packages/core, apps/desktop) does not make
  // listProjects pick those as the primary cwd.
  const sessionPaths = await runSqliteJson<{ project_path: string }>(
    dbPath,
    `SELECT DISTINCT project_path FROM sessions
     WHERE project_id = '${escapeSqlLiteral(projectId)}'
       AND project_path IS NOT NULL AND TRIM(project_path) != '';`
  ).catch(() => [] as Array<{ project_path: string }>);

  const orderedSessionPaths = [...sessionPaths].sort((a, b) => {
    const aCanon = toPortableKey(a.project_path) === portableKey ? 0 : 1;
    const bCanon = toPortableKey(b.project_path) === portableKey ? 0 : 1;
    return aCanon - bCanon;
  });

  for (const row of orderedSessionPaths) {
    const rehomed = expandHome(row.project_path);
    if (rehomed && (await isDirectory(rehomed))) {
      if (persist) {
        await upsertLocalPath(dbPath, projectId, machineId, rehomed, now);
      }
      return { path: rehomed, source: "rehome" };
    }
    const portableFromSession = expandPortableKey(toPortableKey(row.project_path));
    if (portableFromSession && (await isDirectory(portableFromSession))) {
      if (persist) {
        await upsertLocalPath(dbPath, projectId, machineId, portableFromSession, now);
      }
      return { path: portableFromSession, source: "portable" };
    }
  }

  return {
    path: fromPortable || localRow?.absolute_path || "",
    source: "missing"
  };
}

export async function resolveProjectCwd(
  dbPath: string,
  projectId: string
): Promise<ResolveProjectCwdResult> {
  await ensureProjectsCatalogSchema(dbPath);
  const project = await findProjectById(dbPath, projectId);
  if (!project) {
    return {
      cwd: "",
      source: "missing",
      projectId,
      portableKey: ""
    };
  }

  const locals = await runSqliteJson<LocalPathSqlRow>(
    dbPath,
    `SELECT project_id, machine_id, absolute_path, updated_at_ms FROM project_local_paths
     WHERE project_id = '${escapeSqlLiteral(projectId)}';`
  );
  const resolved = await resolveExistingLocalPath(
    dbPath,
    projectId,
    project.portable_key,
    locals,
    { persist: true }
  );

  return {
    cwd: resolved.path,
    source: resolved.source,
    projectId,
    portableKey: project.portable_key
  };
}

export async function resolveProjectCwdForPath(
  dbPath: string,
  projectPath: string
): Promise<ResolveProjectCwdResult> {
  await ensureProjectsCatalogSchema(dbPath);
  const projectId = await ensureProjectForPath(dbPath, projectPath, { touchSeen: false });
  return resolveProjectCwd(dbPath, projectId);
}

export async function listProjects(
  dbPath: string,
  options?: { includeHidden?: boolean }
): Promise<ProjectRow[]> {
  await ensureProjectsCatalogSchema(dbPath);
  const includeHidden = options?.includeHidden === true;
  const rows = await runSqliteJson<ProjectSqlRow>(
    dbPath,
    `SELECT project_id, portable_key, alias, hidden, pinned, last_seen_at_ms, updated_at_ms
     FROM projects
     ${includeHidden ? "" : "WHERE hidden = 0"}
     ORDER BY pinned DESC, COALESCE(last_seen_at_ms, updated_at_ms) DESC;`
  );

  const counts = await runSqliteJson<{ project_id: string; c: number }>(
    dbPath,
    `SELECT project_id, COUNT(*) AS c FROM sessions
     WHERE hidden = 0 AND project_id IS NOT NULL AND TRIM(project_id) != ''
     GROUP BY project_id;`
  );
  const countMap = new Map(counts.map((row) => [row.project_id, Number(row.c) || 0]));

  // Fallback counts by path for sessions not yet linked
  const pathCounts = await runSqliteJson<{ project_path: string; c: number }>(
    dbPath,
    `SELECT project_path, COUNT(*) AS c FROM sessions
     WHERE hidden = 0 AND (project_id IS NULL OR TRIM(project_id) = '')
     GROUP BY project_path;`
  );

  const allLocals = await runSqliteJson<LocalPathSqlRow>(
    dbPath,
    `SELECT project_id, machine_id, absolute_path, updated_at_ms FROM project_local_paths;`
  );
  const localsByProject = new Map<string, LocalPathSqlRow[]>();
  for (const row of allLocals) {
    const list = localsByProject.get(row.project_id) || [];
    list.push(row);
    localsByProject.set(row.project_id, list);
  }

  const output: ProjectRow[] = [];
  for (const row of rows) {
    const locals = localsByProject.get(row.project_id) || [];
    const resolved = await resolveExistingLocalPath(
      dbPath,
      row.project_id,
      row.portable_key,
      locals,
      { persist: true }
    );
    const pathMissing = resolved.source === "missing";
    // Only expose a real path when it exists; otherwise leave null so UI uses portable key + missing label.
    const localPath = pathMissing ? null : resolved.path;

    let sessionCount = countMap.get(row.project_id) || 0;
    if (sessionCount === 0) {
      for (const pc of pathCounts) {
        if (toPortableKey(pc.project_path) === row.portable_key) {
          sessionCount += Number(pc.c) || 0;
        }
      }
    }

    output.push({
      projectId: row.project_id,
      portableKey: row.portable_key,
      alias: (row.alias || "").trim(),
      hidden: Number(row.hidden) === 1,
      pinned: Number(row.pinned) === 1,
      lastSeenAtMs: row.last_seen_at_ms == null ? null : Number(row.last_seen_at_ms),
      updatedAtMs: Number(row.updated_at_ms) || 0,
      localPath,
      pathMissing,
      sessionCount
    });
  }

  return output;
}

/** Alias map keyed by absolute paths (and portable key) for UI label lookup. */
export async function loadProjectAliasesMap(dbPath: string): Promise<Record<string, string>> {
  await ensureProjectsCatalogSchema(dbPath);
  const projects = await runSqliteJson<ProjectSqlRow>(
    dbPath,
    `SELECT project_id, portable_key, alias, hidden, pinned, last_seen_at_ms, updated_at_ms FROM projects;`
  );
  const locals = await runSqliteJson<LocalPathSqlRow>(
    dbPath,
    `SELECT project_id, machine_id, absolute_path, updated_at_ms FROM project_local_paths;`
  );
  const output: Record<string, string> = {};
  for (const project of projects) {
    const alias = (project.alias || "").trim();
    if (!alias) continue;
    output[project.portable_key] = alias;
    output[project.project_id] = alias;
    for (const local of locals) {
      if (local.project_id === project.project_id) {
        output[normalizeProjectPath(local.absolute_path)] = alias;
        output[local.absolute_path] = alias;
      }
    }
    const expanded = expandPortableKey(project.portable_key);
    if (expanded) {
      output[normalizeProjectPath(expanded)] = alias;
    }
  }
  return output;
}

export async function getProjectAliasFromCatalog(
  dbPath: string,
  projectPath: string
): Promise<string | undefined> {
  const map = await loadProjectAliasesMap(dbPath);
  const normalized = normalizeProjectPath(projectPath);
  return map[normalized] || map[toPortableKey(normalized)] || undefined;
}

export async function setProjectAliasInCatalog(
  dbPath: string,
  projectPath: string,
  alias: string
): Promise<void> {
  await ensureProjectsCatalogSchema(dbPath);
  const projectId = await ensureProjectForPath(dbPath, projectPath, { touchSeen: false });
  const trimmed = alias.trim();
  const now = Date.now();
  // Keep row when clearing alias (first-class entity).
  await runSqlite(
    dbPath,
    `UPDATE projects SET alias = '${escapeSqlLiteral(trimmed)}', updated_at_ms = ${now}
     WHERE project_id = '${escapeSqlLiteral(projectId)}';`
  );
}

export async function setProjectAliasById(
  dbPath: string,
  projectId: string,
  alias: string
): Promise<void> {
  await ensureProjectsCatalogSchema(dbPath);
  const trimmed = alias.trim();
  const now = Date.now();
  await runSqlite(
    dbPath,
    `UPDATE projects SET alias = '${escapeSqlLiteral(trimmed)}', updated_at_ms = ${now}
     WHERE project_id = '${escapeSqlLiteral(projectId)}';`
  );
}

export async function upsertProjectAliasesBatch(
  dbPath: string,
  entries: Array<{ projectPath: string; alias: string }>
): Promise<void> {
  if (!entries.length) return;
  await ensureProjectsCatalogSchema(dbPath);
  for (const entry of entries) {
    const trimmed = entry.alias.trim();
    if (!trimmed) continue;
    await setProjectAliasInCatalog(dbPath, entry.projectPath, trimmed);
  }
}

export async function setProjectLocalPath(
  dbPath: string,
  projectId: string,
  absolutePath: string
): Promise<void> {
  await ensureProjectsCatalogSchema(dbPath);
  const machineId = await getMachineId();
  const absolute = normalizeProjectPath(expandHome(absolutePath));
  await upsertLocalPath(dbPath, projectId, machineId, absolute, Date.now());
  // Keep portable_key stable; only bind this machine's path.
  await runSqlite(
    dbPath,
    `UPDATE projects SET updated_at_ms = ${Date.now()}
     WHERE project_id = '${escapeSqlLiteral(projectId)}';`
  );
}

export async function setProjectPinnedInCatalog(
  dbPath: string,
  projectId: string,
  pinned: boolean
): Promise<void> {
  await ensureProjectsCatalogSchema(dbPath);
  const now = Date.now();
  await runSqlite(
    dbPath,
    `UPDATE projects SET pinned = ${pinned ? 1 : 0}, updated_at_ms = ${now}
     WHERE project_id = '${escapeSqlLiteral(projectId)}';`
  );
}

export async function hideProjectInCatalog(
  dbPath: string,
  projectIdOrPath: string
): Promise<{ projectId: string; hiddenSessions: number }> {
  await ensureProjectsCatalogSchema(dbPath);
  let projectId = projectIdOrPath;
  const byId = await findProjectById(dbPath, projectIdOrPath);
  if (!byId) {
    projectId = await ensureProjectForPath(dbPath, projectIdOrPath, { touchSeen: false });
  }
  const now = Date.now();
  await runSqlite(
    dbPath,
    `UPDATE projects SET hidden = 1, updated_at_ms = ${now}
     WHERE project_id = '${escapeSqlLiteral(projectId)}';`
  );

  // Hide by project_id
  const byProject = await runSqliteJson<{ changes: number }>(
    dbPath,
    `UPDATE sessions SET hidden = 1
     WHERE project_id = '${escapeSqlLiteral(projectId)}';
     SELECT changes() AS changes;`
  );
  let hiddenSessions = Number(byProject[0]?.changes) || 0;

  // Also hide sessions matching portable key paths (not yet linked)
  const project = await findProjectById(dbPath, projectId);
  if (project) {
    const paths = await runSqliteJson<{ absolute_path: string }>(
      dbPath,
      `SELECT absolute_path FROM project_local_paths
       WHERE project_id = '${escapeSqlLiteral(projectId)}';`
    );
    const pathList = paths.map((p) => p.absolute_path);
    pathList.push(expandPortableKey(project.portable_key));
    for (const p of pathList) {
      if (!p?.trim()) continue;
      const abs = normalizeProjectPath(p);
      const extra = await runSqliteJson<{ changes: number }>(
        dbPath,
        `UPDATE sessions SET hidden = 1
         WHERE hidden = 0 AND (
           project_path = '${escapeSqlLiteral(abs)}'
           OR project_path = '${escapeSqlLiteral(p)}'
         );
         SELECT changes() AS changes;`
      );
      hiddenSessions += Number(extra[0]?.changes) || 0;
    }
  }

  return { projectId, hiddenSessions };
}

export async function unhideAllProjectsInCatalog(dbPath: string): Promise<number> {
  await ensureProjectsCatalogSchema(dbPath);
  const rows = await runSqliteJson<{ changes: number }>(
    dbPath,
    `UPDATE projects SET hidden = 0 WHERE hidden = 1;
     SELECT changes() AS changes;`
  );
  return Number(rows[0]?.changes) || 0;
}

export async function getProjectById(
  dbPath: string,
  projectId: string
): Promise<ProjectRow | undefined> {
  const all = await listProjects(dbPath, { includeHidden: true });
  return all.find((p) => p.projectId === projectId);
}

/** Distinct absolute paths known for a logical project (sessions + local_paths). */
export async function listProjectPathVariants(
  dbPath: string,
  projectId: string
): Promise<Array<{ absolutePath: string; portableKey: string; sessionCount: number }>> {
  await ensureProjectsCatalogSchema(dbPath);
  const fromSessions = await runSqliteJson<{ project_path: string; c: number }>(
    dbPath,
    `SELECT project_path, COUNT(*) AS c FROM sessions
     WHERE project_id = '${escapeSqlLiteral(projectId)}'
        OR project_path IN (
          SELECT absolute_path FROM project_local_paths
          WHERE project_id = '${escapeSqlLiteral(projectId)}'
        )
     GROUP BY project_path;`
  );
  const fromLocals = await runSqliteJson<{ absolute_path: string }>(
    dbPath,
    `SELECT absolute_path FROM project_local_paths
     WHERE project_id = '${escapeSqlLiteral(projectId)}';`
  );

  const map = new Map<string, { absolutePath: string; portableKey: string; sessionCount: number }>();
  for (const row of fromSessions) {
    if (!row.project_path?.trim()) continue;
    const absolutePath = row.project_path;
    const key = absolutePath;
    map.set(key, {
      absolutePath,
      portableKey: toPortableKey(absolutePath),
      sessionCount: Number(row.c) || 0
    });
  }
  for (const row of fromLocals) {
    if (!row.absolute_path?.trim()) continue;
    if (map.has(row.absolute_path)) continue;
    map.set(row.absolute_path, {
      absolutePath: row.absolute_path,
      portableKey: toPortableKey(row.absolute_path),
      sessionCount: 0
    });
  }
  return [...map.values()].sort((a, b) => a.absolutePath.localeCompare(b.absolutePath));
}

/**
 * Merge source project into target: reassign sessions/local_paths, merge flags, delete source.
 */
export async function mergeProjectsInCatalog(
  dbPath: string,
  sourceProjectId: string,
  targetProjectId: string
): Promise<{ targetProjectId: string; mergedSessions: number }> {
  await ensureProjectsCatalogSchema(dbPath);
  if (!sourceProjectId?.trim() || !targetProjectId?.trim()) {
    throw new Error("sourceProjectId and targetProjectId are required.");
  }
  if (sourceProjectId === targetProjectId) {
    throw new Error("Cannot merge a project into itself.");
  }
  const source = await findProjectById(dbPath, sourceProjectId);
  const target = await findProjectById(dbPath, targetProjectId);
  if (!source || !target) {
    throw new Error("Source or target project not found.");
  }

  const now = Date.now();
  const sessionUpdate = await runSqliteJson<{ changes: number }>(
    dbPath,
    `UPDATE sessions SET project_id = '${escapeSqlLiteral(targetProjectId)}'
     WHERE project_id = '${escapeSqlLiteral(sourceProjectId)}';
     SELECT changes() AS changes;`
  );
  let mergedSessions = Number(sessionUpdate[0]?.changes) || 0;

  // Also claim unlinked sessions whose portable key matches source
  const sourcePaths = await listProjectPathVariants(dbPath, sourceProjectId);
  for (const variant of sourcePaths) {
    const extra = await runSqliteJson<{ changes: number }>(
      dbPath,
      `UPDATE sessions SET project_id = '${escapeSqlLiteral(targetProjectId)}'
       WHERE project_path = '${escapeSqlLiteral(variant.absolutePath)}';
       SELECT changes() AS changes;`
    );
    mergedSessions += Number(extra[0]?.changes) || 0;
  }

  // Move local paths. Keep the target's own path on this machine (INSERT OR
  // IGNORE instead of overwriting) — the absorbed path stays reachable via
  // absorbed_keys below — and add the source's rows for machines the target
  // does not already cover.
  const locals = await runSqliteJson<LocalPathSqlRow>(
    dbPath,
    `SELECT project_id, machine_id, absolute_path, updated_at_ms FROM project_local_paths
     WHERE project_id = '${escapeSqlLiteral(sourceProjectId)}';`
  );
  for (const row of locals) {
    await runSqlite(
      dbPath,
      `INSERT OR IGNORE INTO project_local_paths (project_id, machine_id, absolute_path, updated_at_ms)
       VALUES ('${escapeSqlLiteral(targetProjectId)}', '${escapeSqlLiteral(row.machine_id)}',
               '${escapeSqlLiteral(row.absolute_path)}', ${now});`
    );
  }
  await runSqlite(
    dbPath,
    `DELETE FROM project_local_paths WHERE project_id = '${escapeSqlLiteral(sourceProjectId)}';`
  );

  // Record which portable keys this target has absorbed so the periodic
  // reconcile keeps routing those paths back to it — even after later merges
  // overwrite this machine's local-path binding — instead of re-creating the
  // merged-away project and splitting its sessions back out.
  const absorbed = new Set<string>(parseAbsorbedKeys(target.absorbed_keys));
  for (const key of parseAbsorbedKeys(source.absorbed_keys)) absorbed.add(key);
  absorbed.add(source.portable_key);
  for (const row of locals) absorbed.add(toPortableKey(row.absolute_path));
  const absorbedJson = absorbed.size ? JSON.stringify([...absorbed]) : null;

  // Merge personalization onto target
  const sourceAlias = (source.alias || "").trim();
  const targetAlias = (target.alias || "").trim();
  const alias = targetAlias || sourceAlias;
  const pinned = Number(source.pinned) === 1 || Number(target.pinned) === 1 ? 1 : 0;
  const hidden = Number(source.hidden) === 1 && Number(target.hidden) === 1 ? 1 : 0;
  await runSqlite(
    dbPath,
    `UPDATE projects SET
       alias = '${escapeSqlLiteral(alias)}',
       pinned = ${pinned},
       hidden = ${hidden},
       absorbed_keys = ${absorbedJson ? `'${escapeSqlLiteral(absorbedJson)}'` : "NULL"},
       updated_at_ms = ${now},
       last_seen_at_ms = ${now}
     WHERE project_id = '${escapeSqlLiteral(targetProjectId)}';
     DELETE FROM projects WHERE project_id = '${escapeSqlLiteral(sourceProjectId)}';`
  );

  return { targetProjectId, mergedSessions };
}

/**
 * Peel absolutePath (and matching sessions) out of source into its own project.
 * If a project already exists for that portable_key, merge into it instead of creating a duplicate key.
 */
export async function splitProjectPathInCatalog(
  dbPath: string,
  sourceProjectId: string,
  absolutePath: string
): Promise<{ projectId: string; movedSessions: number; created: boolean }> {
  await ensureProjectsCatalogSchema(dbPath);
  const source = await findProjectById(dbPath, sourceProjectId);
  if (!source) {
    throw new Error("Source project not found.");
  }
  const absolute = normalizeProjectPath(expandHome(absolutePath.trim()));
  if (!absolute) {
    throw new Error("absolutePath is required.");
  }

  const portableKey = toPortableKey(absolute);
  const now = Date.now();
  let created = false;
  let projectId: string;

  const existing = await findProjectByPortableKey(dbPath, portableKey);
  if (existing && existing.project_id !== sourceProjectId) {
    projectId = existing.project_id;
  } else if (existing && existing.project_id === sourceProjectId && portableKey === source.portable_key) {
    // Same logical key as source — still allow a new project only if path identity differs via abs: fallback
    // For identical portable keys, rebinding local path is preferred over split.
    throw new Error(
      "This path shares the same portable key as the project. Use “Set local folder” instead of split."
    );
  } else {
    projectId = newProjectId();
    created = true;
    await runSqlite(
      dbPath,
      `INSERT INTO projects (project_id, portable_key, alias, hidden, pinned, last_seen_at_ms, updated_at_ms)
       VALUES ('${escapeSqlLiteral(projectId)}', '${escapeSqlLiteral(portableKey)}', '', 0, 0, ${now}, ${now});`
    );
  }

  // Move sessions whose absolute path or portable key matches the peeled path
  const allSourceSessions = await runSqliteJson<{ provider: string; agent_session_id: string; project_path: string }>(
    dbPath,
    `SELECT provider, agent_session_id, project_path FROM sessions
     WHERE project_id = '${escapeSqlLiteral(sourceProjectId)}';`
  );
  let movedSessions = 0;
  for (const row of allSourceSessions) {
    const matchesExact =
      row.project_path === absolute || row.project_path === absolutePath.trim();
    const matchesKey = toPortableKey(row.project_path) === portableKey;
    if (!matchesExact && !matchesKey) continue;
    await runSqlite(
      dbPath,
      `UPDATE sessions SET project_id = '${escapeSqlLiteral(projectId)}'
       WHERE provider = '${escapeSqlLiteral(row.provider)}'
         AND agent_session_id = '${escapeSqlLiteral(row.agent_session_id)}';`
    );
    movedSessions += 1;
  }

  const machineId = await getMachineId();
  await upsertLocalPath(dbPath, projectId, machineId, absolute, now);
  await runSqlite(
    dbPath,
    `DELETE FROM project_local_paths
     WHERE project_id = '${escapeSqlLiteral(sourceProjectId)}'
       AND absolute_path = '${escapeSqlLiteral(absolute)}';`
  );

  // This path is no longer absorbed: split gives it a real project again, so
  // drop it from the source's absorbed_keys to keep reconcile routing it here.
  if (source.absorbed_keys) {
    const remaining = parseAbsorbedKeys(source.absorbed_keys).filter((key) => key !== portableKey);
    await runSqlite(
      dbPath,
      `UPDATE projects SET
         absorbed_keys = ${remaining.length ? `'${escapeSqlLiteral(JSON.stringify(remaining))}'` : "NULL"}
       WHERE project_id = '${escapeSqlLiteral(sourceProjectId)}';`
    );
  }

  // If source has no remaining sessions and no local paths, hide empty shell (keep for alias history)
  const remaining = await runSqliteJson<{ c: number }>(
    dbPath,
    `SELECT COUNT(*) AS c FROM sessions WHERE project_id = '${escapeSqlLiteral(sourceProjectId)}' AND hidden = 0;`
  );
  if ((Number(remaining[0]?.c) || 0) === 0) {
    await runSqlite(
      dbPath,
      `UPDATE projects SET updated_at_ms = ${now}
       WHERE project_id = '${escapeSqlLiteral(sourceProjectId)}';`
    );
  }

  return { projectId, movedSessions, created };
}

export interface TidyProjectCandidate {
  projectId: string;
  portableKey: string;
  alias: string;
  localPath: string | null;
  /** Number of visible sessions. */
  sessionCount: number;
}

/**
 * Tidy the projects catalog: hide stale/empty projects that are not pinned,
 * have no visible sessions, and have no resolvable local directory. Hidden
 * projects stay recoverable (unhide) — nothing is deleted. Dry-run by default.
 */
export async function tidyProjectsInCatalog(
  dbPath: string,
  options?: { dryRun?: boolean }
): Promise<{ dryRun: boolean; hiddenProjects: number; candidates: TidyProjectCandidate[] }> {
  await ensureProjectsCatalogSchema(dbPath);
  const projects = await listProjects(dbPath, { includeHidden: true });
  const candidates: TidyProjectCandidate[] = projects
    .filter((p) => !p.pinned && !p.hidden && p.sessionCount === 0 && p.pathMissing)
    .map((p) => ({
      projectId: p.projectId,
      portableKey: p.portableKey,
      alias: (p.alias || "").trim(),
      localPath: p.localPath,
      sessionCount: p.sessionCount
    }));

  if (options?.dryRun !== false) {
    return { dryRun: true, hiddenProjects: 0, candidates };
  }

  for (const candidate of candidates) {
    await hideProjectInCatalog(dbPath, candidate.projectId);
  }
  return { dryRun: false, hiddenProjects: candidates.length, candidates };
}

/**
 * Reassign one catalog session to a different project directory (catalog
 * metadata only). The target project is reused when it already exists for the
 * path, otherwise created. Session-scoped note catalog rows follow the new
 * project path; on-disk session/note files are never moved.
 */
export async function moveSessionToProjectInCatalog(
  dbPath: string,
  provider: string,
  sessionId: string,
  targetProjectPath: string
): Promise<{
  provider: string;
  sessionId: string;
  moved: boolean;
  fromProjectId: string | null;
  toProjectId: string;
  oldPath: string;
  newPath: string;
}> {
  await ensureProjectsCatalogSchema(dbPath);
  const providerT = provider?.trim();
  const sessionIdT = sessionId?.trim();
  const target = normalizeProjectPath(expandHome(targetProjectPath?.trim() || ""));
  if (!providerT || !sessionIdT) {
    throw new Error("provider and sessionId are required.");
  }
  if (!target) {
    throw new Error("targetProjectPath is required.");
  }

  const rows = await runSqliteJson<{ project_id: string | null; project_path: string | null }>(
    dbPath,
    `SELECT project_id, project_path FROM sessions
     WHERE provider = '${escapeSqlLiteral(providerT)}'
       AND agent_session_id = '${escapeSqlLiteral(sessionIdT)}' LIMIT 1;`
  );
  const row = rows[0];
  if (!row) {
    throw new Error(`Session not found: ${providerT}:${sessionIdT}.`);
  }

  const now = Date.now();
  const toProjectId = await ensureProjectForPath(dbPath, target, { touchSeen: true });
  const oldPath = row.project_path || "";
  const normalizedOld = oldPath ? normalizeProjectPath(expandHome(oldPath)) : "";
  if (normalizedOld === target && row.project_id === toProjectId) {
    return {
      provider: providerT,
      sessionId: sessionIdT,
      moved: false,
      fromProjectId: row.project_id,
      toProjectId,
      oldPath,
      newPath: target
    };
  }

  await runSqlite(
    dbPath,
    `UPDATE sessions SET project_path = '${escapeSqlLiteral(target)}',
                         project_id = '${escapeSqlLiteral(toProjectId)}',
                         updated_at_ms = ${now}
     WHERE provider = '${escapeSqlLiteral(providerT)}'
       AND agent_session_id = '${escapeSqlLiteral(sessionIdT)}';`
  );

  // Session-scoped note catalog rows follow the session's new project path.
  try {
    await runSqlite(
      dbPath,
      `UPDATE notes SET project_path = '${escapeSqlLiteral(target)}'
       WHERE scope = 'session'
         AND provider = '${escapeSqlLiteral(providerT)}'
         AND agent_session_id = '${escapeSqlLiteral(sessionIdT)}';`
    );
  } catch {
    // Older catalogs may lack the notes table — ignore.
  }

  return {
    provider: providerT,
    sessionId: sessionIdT,
    moved: true,
    fromProjectId: row.project_id,
    toProjectId,
    oldPath,
    newPath: target
  };
}
