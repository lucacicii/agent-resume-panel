import { escapeSqlLiteral, runSqlite, runSqliteJson } from "../sqlite";
import { getNoteById, type NoteRecord } from "./catalogNotes";

export interface NoteLink {
  parentNoteId: string;
  childNoteId: string;
  createdAtMs: number;
}

export interface NoteTreeNode {
  noteId: string;
  title: string;
  filename: string;
  projectPath?: string;
  children: NoteTreeNode[];
}

export interface NoteSubtree {
  rootNoteId: string;
  root: NoteTreeNode;
  /** Flat map for quick lookups / selection. */
  nodesById: Record<string, NoteTreeNode>;
  edges: Array<{ parentNoteId: string; childNoteId: string }>;
}

interface NoteLinkRow {
  child_note_id: string;
  parent_note_id: string;
  created_at_ms: number;
}

function mapLinkRow(row: NoteLinkRow): NoteLink {
  return {
    parentNoteId: row.parent_note_id,
    childNoteId: row.child_note_id,
    createdAtMs: row.created_at_ms
  };
}

export async function listAllNoteLinks(dbPath: string): Promise<NoteLink[]> {
  const rows = await runSqliteJson<NoteLinkRow>(
    dbPath,
    `SELECT child_note_id, parent_note_id, created_at_ms FROM note_links;`
  );
  return rows.map(mapLinkRow);
}

export async function getParentLink(
  dbPath: string,
  childNoteId: string
): Promise<NoteLink | undefined> {
  const rows = await runSqliteJson<NoteLinkRow>(
    dbPath,
    `SELECT child_note_id, parent_note_id, created_at_ms FROM note_links
     WHERE child_note_id = '${escapeSqlLiteral(childNoteId)}' LIMIT 1;`
  );
  return rows[0] ? mapLinkRow(rows[0]) : undefined;
}

export async function listChildLinks(dbPath: string, parentNoteId: string): Promise<NoteLink[]> {
  const rows = await runSqliteJson<NoteLinkRow>(
    dbPath,
    `SELECT child_note_id, parent_note_id, created_at_ms FROM note_links
     WHERE parent_note_id = '${escapeSqlLiteral(parentNoteId)}'
     ORDER BY created_at_ms ASC;`
  );
  return rows.map(mapLinkRow);
}

export async function deleteLinksForNote(dbPath: string, noteId: string): Promise<void> {
  const id = escapeSqlLiteral(noteId);
  await runSqlite(
    dbPath,
    `DELETE FROM note_links WHERE child_note_id = '${id}' OR parent_note_id = '${id}';`
  );
}

export async function clearParentLink(dbPath: string, childNoteId: string): Promise<void> {
  await runSqlite(
    dbPath,
    `DELETE FROM note_links WHERE child_note_id = '${escapeSqlLiteral(childNoteId)}';`
  );
}

/** All note ids that appear as children (have a parent). */
export async function listLinkedChildNoteIds(dbPath: string): Promise<Set<string>> {
  const rows = await runSqliteJson<{ child_note_id: string }>(
    dbPath,
    `SELECT child_note_id FROM note_links;`
  );
  return new Set(rows.map((row) => row.child_note_id));
}

/** Direct child counts keyed by parent note id. */
export async function listChildCounts(dbPath: string): Promise<Map<string, number>> {
  const rows = await runSqliteJson<{ parent_note_id: string; cnt: number }>(
    dbPath,
    `SELECT parent_note_id, COUNT(*) AS cnt FROM note_links GROUP BY parent_note_id;`
  );
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.parent_note_id, Number(row.cnt) || 0);
  }
  return map;
}

export async function collectDescendantIds(
  dbPath: string,
  rootNoteId: string
): Promise<Set<string>> {
  const links = await listAllNoteLinks(dbPath);
  const childrenByParent = new Map<string, string[]>();
  for (const link of links) {
    const list = childrenByParent.get(link.parentNoteId) ?? [];
    list.push(link.childNoteId);
    childrenByParent.set(link.parentNoteId, list);
  }

  const descendants = new Set<string>();
  const stack = [...(childrenByParent.get(rootNoteId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (descendants.has(id)) {
      continue;
    }
    descendants.add(id);
    for (const child of childrenByParent.get(id) ?? []) {
      stack.push(child);
    }
  }
  return descendants;
}

/**
 * Returns true if setting parent of `childNoteId` to `parentNoteId` would create a cycle.
 * Cycle if parentNoteId === childNoteId or parent is already a descendant of child.
 */
export async function wouldCreateCycle(
  dbPath: string,
  childNoteId: string,
  parentNoteId: string
): Promise<boolean> {
  if (childNoteId === parentNoteId) {
    return true;
  }
  const descendants = await collectDescendantIds(dbPath, childNoteId);
  return descendants.has(parentNoteId);
}

function assertProjectNote(record: NoteRecord, label: string): void {
  if (record.scope !== "project") {
    throw new Error(`${label} must be a project note to participate in links.`);
  }
}

export async function setParentLink(
  dbPath: string,
  childNoteId: string,
  parentNoteId: string | null
): Promise<void> {
  if (parentNoteId === null) {
    await clearParentLink(dbPath, childNoteId);
    return;
  }

  if (childNoteId === parentNoteId) {
    throw new Error("A note cannot be its own parent.");
  }

  const child = await getNoteById(dbPath, childNoteId);
  if (!child) {
    throw new Error("Child note not found.");
  }
  const parent = await getNoteById(dbPath, parentNoteId);
  if (!parent) {
    throw new Error("Parent note not found.");
  }
  assertProjectNote(child, "Child note");
  assertProjectNote(parent, "Parent note");

  if (await wouldCreateCycle(dbPath, childNoteId, parentNoteId)) {
    throw new Error("Link would create a cycle.");
  }

  const now = Date.now();
  await runSqlite(
    dbPath,
    `INSERT INTO note_links (child_note_id, parent_note_id, created_at_ms) VALUES (
       '${escapeSqlLiteral(childNoteId)}',
       '${escapeSqlLiteral(parentNoteId)}',
       ${now}
     )
     ON CONFLICT(child_note_id) DO UPDATE SET
       parent_note_id = excluded.parent_note_id,
       created_at_ms = excluded.created_at_ms;`
  );
}

function treeNodeFromRecord(record: NoteRecord): NoteTreeNode {
  return {
    noteId: record.noteId,
    title: record.title || record.filename.replace(/\.md$/i, "") || record.noteId,
    filename: record.filename,
    projectPath: record.projectPath,
    children: []
  };
}

/**
 * Build top-to-bottom subtree rooted at `rootNoteId` (all descendants).
 * Missing notes (orphan edges) are skipped.
 */
export async function getNoteSubtree(dbPath: string, rootNoteId: string): Promise<NoteSubtree> {
  const rootRecord = await getNoteById(dbPath, rootNoteId);
  if (!rootRecord) {
    throw new Error("Note not found.");
  }

  const links = await listAllNoteLinks(dbPath);
  const childrenByParent = new Map<string, string[]>();
  for (const link of links) {
    const list = childrenByParent.get(link.parentNoteId) ?? [];
    list.push(link.childNoteId);
    childrenByParent.set(link.parentNoteId, list);
  }

  const edges: Array<{ parentNoteId: string; childNoteId: string }> = [];
  const nodesById: Record<string, NoteTreeNode> = {};

  const build = async (noteId: string): Promise<NoteTreeNode | undefined> => {
    const record = await getNoteById(dbPath, noteId);
    if (!record) {
      return undefined;
    }
    const node = treeNodeFromRecord(record);
    nodesById[noteId] = node;
    const childIds = childrenByParent.get(noteId) ?? [];
    for (const childId of childIds) {
      const childNode = await build(childId);
      if (childNode) {
        node.children.push(childNode);
        edges.push({ parentNoteId: noteId, childNoteId: childId });
      }
    }
    return node;
  };

  const root = await build(rootNoteId);
  if (!root) {
    throw new Error("Note not found.");
  }

  return { rootNoteId, root, nodesById, edges };
}

/** Walk parent links until a root (no parent) is found. */
export async function resolveLinkRoot(dbPath: string, noteId: string): Promise<string> {
  const seen = new Set<string>();
  let current = noteId;
  while (true) {
    if (seen.has(current)) {
      // Broken cycle in data; treat current as root.
      return current;
    }
    seen.add(current);
    const parent = await getParentLink(dbPath, current);
    if (!parent) {
      return current;
    }
    current = parent.parentNoteId;
  }
}
