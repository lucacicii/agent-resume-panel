import { randomUUID } from "node:crypto";
import { escapeSqlLiteral, runSqliteJson, runSqliteTransaction } from "../sqlite";

export interface WorkbenchSessionFolder {
  folderId: string;
  projectId: string;
  parentId: string | null;
  name: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface WorkbenchSessionFolderAssignment {
  projectId: string;
  provider: string;
  agentSessionId: string;
  folderId: string;
  updatedAtMs: number;
}

interface WorkbenchSessionFolderSqlRow {
  folder_id: string;
  project_id: string;
  parent_id: string | null;
  name: string;
  created_at_ms: number;
  updated_at_ms: number;
}

interface WorkbenchSessionFolderAssignmentSqlRow {
  project_id: string;
  provider: string;
  agent_session_id: string;
  folder_id: string;
  updated_at_ms: number;
}

interface WorkbenchSessionFolderItemSqlRow {
  provider: string;
  agent_session_id: string;
  folder_id: string | null;
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function folderName(value: string): string {
  const normalized = required(value, "Folder name");
  if (normalized.length > 200) throw new Error("Folder name is too long.");
  return normalized;
}

function toFolder(row: WorkbenchSessionFolderSqlRow): WorkbenchSessionFolder {
  return {
    folderId: row.folder_id,
    projectId: row.project_id,
    parentId: row.parent_id || null,
    name: row.name,
    createdAtMs: Number(row.created_at_ms) || 0,
    updatedAtMs: Number(row.updated_at_ms) || 0
  };
}

function toAssignment(row: WorkbenchSessionFolderAssignmentSqlRow): WorkbenchSessionFolderAssignment {
  return {
    projectId: row.project_id,
    provider: row.provider,
    agentSessionId: row.agent_session_id,
    folderId: row.folder_id,
    updatedAtMs: Number(row.updated_at_ms) || 0
  };
}

async function getFolder(dbPath: string, folderId: string): Promise<WorkbenchSessionFolder | null> {
  const rows = await runSqliteJson<WorkbenchSessionFolderSqlRow>(
    dbPath,
    `SELECT folder_id, project_id, parent_id, name, created_at_ms, updated_at_ms
     FROM workbench_session_folders
     WHERE folder_id = '${escapeSqlLiteral(folderId)}'
     LIMIT 1;`
  );
  return rows[0] ? toFolder(rows[0]) : null;
}

async function assertParent(
  dbPath: string,
  projectId: string,
  parentId: string | null
): Promise<void> {
  if (!parentId) return;
  const parent = await getFolder(dbPath, parentId);
  if (!parent || parent.projectId !== projectId) {
    throw new Error("Parent folder does not belong to this project.");
  }
}

async function assertSiblingNameAvailable(
  dbPath: string,
  projectId: string,
  parentId: string | null,
  name: string,
  excludedFolderId?: string
): Promise<void> {
  const parentSql = parentId ? `'${escapeSqlLiteral(parentId)}'` : "NULL";
  const excludedSql = excludedFolderId
    ? `AND folder_id <> '${escapeSqlLiteral(excludedFolderId)}'`
    : "";
  const rows = await runSqliteJson<{ folder_id: string }>(
    dbPath,
    `SELECT folder_id
     FROM workbench_session_folders
     WHERE project_id = '${escapeSqlLiteral(projectId)}'
       AND parent_id IS ${parentId ? "NOT NULL" : "NULL"}
       ${parentId ? `AND parent_id = ${parentSql}` : ""}
       AND name = '${escapeSqlLiteral(name)}' COLLATE NOCASE
       ${excludedSql}
     LIMIT 1;`
  );
  if (rows[0]) throw new Error("A folder with this name already exists here.");
}

export async function listWorkbenchSessionFolders(
  dbPath: string,
  projectId: string
): Promise<WorkbenchSessionFolder[]> {
  const normalizedProjectId = required(projectId, "Project ID");
  const rows = await runSqliteJson<WorkbenchSessionFolderSqlRow>(
    dbPath,
    `SELECT folder_id, project_id, parent_id, name, created_at_ms, updated_at_ms
     FROM workbench_session_folders
     WHERE project_id = '${escapeSqlLiteral(normalizedProjectId)}'
     ORDER BY name COLLATE NOCASE ASC, created_at_ms ASC, folder_id ASC;`
  );
  return rows.map(toFolder);
}

export async function listWorkbenchSessionFolderAssignments(
  dbPath: string,
  projectId: string
): Promise<WorkbenchSessionFolderAssignment[]> {
  const normalizedProjectId = required(projectId, "Project ID");
  const rows = await runSqliteJson<WorkbenchSessionFolderAssignmentSqlRow>(
    dbPath,
    `SELECT project_id, provider, agent_session_id, folder_id, updated_at_ms
     FROM workbench_session_folder_items
     WHERE project_id = '${escapeSqlLiteral(normalizedProjectId)}'
       AND folder_id IS NOT NULL
     ORDER BY updated_at_ms DESC, provider ASC, agent_session_id ASC;`
  );
  return rows.map(toAssignment);
}

export async function createWorkbenchSessionFolder(
  dbPath: string,
  projectId: string,
  parentId: string | null,
  name: string
): Promise<WorkbenchSessionFolder> {
  const normalizedProjectId = required(projectId, "Project ID");
  const normalizedParentId = parentId?.trim() || null;
  const normalizedName = folderName(name);
  await assertParent(dbPath, normalizedProjectId, normalizedParentId);
  await assertSiblingNameAvailable(dbPath, normalizedProjectId, normalizedParentId, normalizedName);

  const now = Date.now();
  const folderId = randomUUID();
  await runSqliteTransaction(dbPath, [`
    INSERT INTO workbench_session_folders
      (folder_id, project_id, parent_id, name, created_at_ms, updated_at_ms)
    VALUES
      ('${escapeSqlLiteral(folderId)}', '${escapeSqlLiteral(normalizedProjectId)}',
       ${normalizedParentId ? `'${escapeSqlLiteral(normalizedParentId)}'` : "NULL"},
       '${escapeSqlLiteral(normalizedName)}', ${now}, ${now})
  `]);
  return {
    folderId,
    projectId: normalizedProjectId,
    parentId: normalizedParentId,
    name: normalizedName,
    createdAtMs: now,
    updatedAtMs: now
  };
}

export async function renameWorkbenchSessionFolder(
  dbPath: string,
  folderId: string,
  name: string
): Promise<WorkbenchSessionFolder> {
  const normalizedFolderId = required(folderId, "Folder ID");
  const folder = await getFolder(dbPath, normalizedFolderId);
  if (!folder) throw new Error("Folder not found.");
  const normalizedName = folderName(name);
  await assertSiblingNameAvailable(
    dbPath,
    folder.projectId,
    folder.parentId,
    normalizedName,
    normalizedFolderId
  );
  const now = Date.now();
  await runSqliteTransaction(dbPath, [`
    UPDATE workbench_session_folders
    SET name = '${escapeSqlLiteral(normalizedName)}', updated_at_ms = ${now}
    WHERE folder_id = '${escapeSqlLiteral(normalizedFolderId)}'
  `]);
  return { ...folder, name: normalizedName, updatedAtMs: now };
}

export async function deleteWorkbenchSessionFolder(
  dbPath: string,
  folderId: string
): Promise<{ folderId: string; projectId: string; parentId: string | null }> {
  const normalizedFolderId = required(folderId, "Folder ID");
  const folder = await getFolder(dbPath, normalizedFolderId);
  if (!folder) throw new Error("Folder not found.");

  const parentSql = folder.parentId ? `'${escapeSqlLiteral(folder.parentId)}'` : "NULL";
  const moveItems = folder.parentId
    ? `UPDATE workbench_session_folder_items
       SET folder_id = ${parentSql}, updated_at_ms = ${Date.now()}
       WHERE folder_id = '${escapeSqlLiteral(normalizedFolderId)}'`
    : `DELETE FROM workbench_session_folder_items
       WHERE folder_id = '${escapeSqlLiteral(normalizedFolderId)}'`;
  await runSqliteTransaction(dbPath, [
    `UPDATE workbench_session_folders
     SET parent_id = ${parentSql}, updated_at_ms = ${Date.now()}
     WHERE parent_id = '${escapeSqlLiteral(normalizedFolderId)}'`,
    moveItems,
    `DELETE FROM workbench_session_folders
     WHERE folder_id = '${escapeSqlLiteral(normalizedFolderId)}'`
  ]);
  return {
    folderId: normalizedFolderId,
    projectId: folder.projectId,
    parentId: folder.parentId
  };
}

export async function assignWorkbenchSessionToFolder(
  dbPath: string,
  projectId: string,
  provider: string,
  agentSessionId: string,
  folderId: string
): Promise<WorkbenchSessionFolderAssignment> {
  const normalizedProjectId = required(projectId, "Project ID");
  const normalizedProvider = required(provider, "Session provider");
  const normalizedSessionId = required(agentSessionId, "Session ID");
  const normalizedFolderId = required(folderId, "Folder ID");
  const folder = await getFolder(dbPath, normalizedFolderId);
  if (!folder || folder.projectId !== normalizedProjectId) {
    throw new Error("Folder does not belong to this project.");
  }
  const now = Date.now();
  await runSqliteTransaction(dbPath, [`
    INSERT INTO workbench_session_folder_items
      (project_id, provider, agent_session_id, folder_id, updated_at_ms)
    VALUES
      ('${escapeSqlLiteral(normalizedProjectId)}', '${escapeSqlLiteral(normalizedProvider)}',
       '${escapeSqlLiteral(normalizedSessionId)}', '${escapeSqlLiteral(normalizedFolderId)}', ${now})
    ON CONFLICT(provider, agent_session_id) DO UPDATE SET
      project_id = excluded.project_id,
      folder_id = excluded.folder_id,
      updated_at_ms = excluded.updated_at_ms
  `]);
  return {
    projectId: normalizedProjectId,
    provider: normalizedProvider,
    agentSessionId: normalizedSessionId,
    folderId: normalizedFolderId,
    updatedAtMs: now
  };
}

export async function removeWorkbenchSessionFromFolder(
  dbPath: string,
  provider: string,
  agentSessionId: string
): Promise<{ ok: true }> {
  const normalizedProvider = required(provider, "Session provider");
  const normalizedSessionId = required(agentSessionId, "Session ID");
  await runSqliteTransaction(dbPath, [`
    DELETE FROM workbench_session_folder_items
    WHERE provider = '${escapeSqlLiteral(normalizedProvider)}'
      AND agent_session_id = '${escapeSqlLiteral(normalizedSessionId)}'
  `]);
  return { ok: true };
}

/** Preserve the source tree when an existing catalog project is merged into another project. */
export async function mergeWorkbenchSessionFolders(
  dbPath: string,
  sourceProjectId: string,
  targetProjectId: string
): Promise<{ movedFolders: number; movedAssignments: number }> {
  const sourceId = required(sourceProjectId, "Source project ID");
  const targetId = required(targetProjectId, "Target project ID");
  if (sourceId === targetId) throw new Error("Cannot merge a project into itself.");

  const sourceFolders = await listWorkbenchSessionFolders(dbPath, sourceId);
  const targetFolders = await listWorkbenchSessionFolders(dbPath, targetId);
  const sourceItems = await runSqliteJson<WorkbenchSessionFolderItemSqlRow>(
    dbPath,
    `SELECT provider, agent_session_id, folder_id
     FROM workbench_session_folder_items
     WHERE project_id = '${escapeSqlLiteral(sourceId)}';`
  );
  if (!sourceFolders.length && !sourceItems.length) {
    return { movedFolders: 0, movedAssignments: 0 };
  }

  const byId = new Map(sourceFolders.map((folder) => [folder.folderId, folder]));
  const mappedIds = new Map<string, string>();
  const usedNames = new Set(
    targetFolders.map((folder) => `${folder.parentId || ""}\u0000${folder.name.toLocaleLowerCase()}`)
  );
  const depth = (folder: WorkbenchSessionFolder): number => {
    let count = 0;
    let parentId = folder.parentId;
    const seen = new Set<string>();
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      count += 1;
      parentId = byId.get(parentId)?.parentId || null;
    }
    return count;
  };
  const now = Date.now();
  const statements: string[] = [];

  for (const folder of [...sourceFolders].sort((left, right) => depth(left) - depth(right))) {
    const parentId = folder.parentId ? mappedIds.get(folder.parentId) || null : null;
    let name = folder.name;
    let suffix = 2;
    while (usedNames.has(`${parentId || ""}\u0000${name.toLocaleLowerCase()}`)) {
      name = `${folder.name} (${suffix})`;
      suffix += 1;
    }
    const newFolderId = randomUUID();
    mappedIds.set(folder.folderId, newFolderId);
    usedNames.add(`${parentId || ""}\u0000${name.toLocaleLowerCase()}`);
    statements.push(`
      INSERT INTO workbench_session_folders
        (folder_id, project_id, parent_id, name, created_at_ms, updated_at_ms)
      VALUES
        ('${escapeSqlLiteral(newFolderId)}', '${escapeSqlLiteral(targetId)}',
         ${parentId ? `'${escapeSqlLiteral(parentId)}'` : "NULL"},
         '${escapeSqlLiteral(name)}', ${folder.createdAtMs || now}, ${now})
    `);
  }

  let movedAssignments = 0;
  for (const item of sourceItems) {
    const folderId = item.folder_id ? mappedIds.get(item.folder_id) : null;
    if (!folderId) continue;
    movedAssignments += 1;
    statements.push(`
      INSERT INTO workbench_session_folder_items
        (project_id, provider, agent_session_id, folder_id, updated_at_ms)
      VALUES
        ('${escapeSqlLiteral(targetId)}', '${escapeSqlLiteral(item.provider)}',
         '${escapeSqlLiteral(item.agent_session_id)}', '${escapeSqlLiteral(folderId)}', ${now})
      ON CONFLICT(provider, agent_session_id) DO UPDATE SET
        project_id = excluded.project_id,
        folder_id = excluded.folder_id,
        updated_at_ms = excluded.updated_at_ms
    `);
  }
  statements.push(`DELETE FROM workbench_session_folder_items WHERE project_id = '${escapeSqlLiteral(sourceId)}'`);
  statements.push(`DELETE FROM workbench_session_folders WHERE project_id = '${escapeSqlLiteral(sourceId)}'`);
  await runSqliteTransaction(dbPath, statements);
  return { movedFolders: sourceFolders.length, movedAssignments };
}
