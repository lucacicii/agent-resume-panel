import { GTD_STATUSES, type GtdStatus } from "../gtd/types";
import { loadSessionGtdMap, sessionGtdKey } from "../gtd/store";
import { listAllNoteLinks } from "./links";
import { listWorkItems, listWorkItemSessionLinks } from "./catalogNotes";
import { getNoteGtdStatus, loadNoteGtdMap } from "./gtd";

/**
 * Task (work item) GTD rollup.
 *
 * A task's GTD status is the aggregate of the entities under it: its note
 * subtree (children, grandchildren, …) and the sessions linked to it. The work
 * item's own `note_gtd` mark acts as an explicit **override** (a pin); an
 * `inbox` mark is the implicit default and does not pin.
 *
 * Only **explicitly marked** entities contribute. Unmarked notes/sessions are
 * neutral — otherwise every task with sessions would collapse to `inbox`.
 */

/** Ladder order: the first status present wins. `done` is handled last. */
export const TASK_GTD_LADDER: readonly GtdStatus[] = [
  "next",
  "waiting",
  "inbox",
  "someday",
  "reference"
];

export interface TaskGtdCounts {
  inbox: number;
  next: number;
  waiting: number;
  someday: number;
  reference: number;
  done: number;
}

export interface TaskGtdRollup {
  /** Status the board/task page should show (override when pinned, else rollup). */
  status: GtdStatus;
  /** Explicit pin from the work item note, when present and not `inbox`. */
  override?: GtdStatus;
  /** Counts per status over the contributing entities (not the work item). */
  counts: TaskGtdCounts;
  /** Number of contributing (explicitly marked) entities. */
  total: number;
  /** Marked `done` / total, or 0 when there is nothing to count. */
  doneRatio: number;
}

export function emptyTaskGtdCounts(): TaskGtdCounts {
  const counts = {} as TaskGtdCounts;
  for (const status of GTD_STATUSES) counts[status] = 0;
  return counts;
}

/**
 * Deterministic aggregate over marked statuses.
 *
 * `next` beats `waiting` beats `inbox` beats `someday` beats `reference`;
 * `done` only wins when every contribution is `done` (and there is at least one).
 */
export function rollupTaskGtdStatuses(statuses: readonly GtdStatus[]): {
  status: GtdStatus;
  counts: TaskGtdCounts;
  total: number;
} {
  const counts = emptyTaskGtdCounts();
  for (const status of statuses) counts[status] += 1;
  const total = statuses.length;
  if (total === 0) {
    return { status: "inbox", counts, total };
  }
  for (const candidate of TASK_GTD_LADDER) {
    if (counts[candidate] > 0) return { status: candidate, counts, total };
  }
  return { status: "done", counts, total };
}

function toRollup(statuses: readonly GtdStatus[], override: GtdStatus | undefined): TaskGtdRollup {
  const { status, counts, total } = rollupTaskGtdStatuses(statuses);
  return {
    status: override ?? status,
    override,
    counts,
    total,
    doneRatio: total > 0 ? counts.done / total : 0
  };
}

/** Override is the work item's own mark, except the implicit `inbox` default. */
function overrideFrom(own: GtdStatus | undefined): GtdStatus | undefined {
  return own && own !== "inbox" ? own : undefined;
}

/** Note ids under a work item (its full subtree, excluding the work item itself). */
function subtreeNoteIds(
  rootNoteId: string,
  childrenByParent: Map<string, string[]>
): string[] {
  const output: string[] = [];
  const seen = new Set<string>([rootNoteId]);
  const stack = [...(childrenByParent.get(rootNoteId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    output.push(id);
    const children = childrenByParent.get(id);
    if (children) stack.push(...children);
  }
  return output;
}

/** Rollup for one task. */
export async function resolveTaskGtdRollup(
  catalogDb: string,
  noteId: string
): Promise<TaskGtdRollup> {
  const [noteGtd, sessionGtd, links, sessionLinks, own] = await Promise.all([
    loadNoteGtdMap(catalogDb),
    loadSessionGtdMap(catalogDb),
    listAllNoteLinks(catalogDb).catch(() => []),
    listWorkItemSessionLinks(catalogDb).catch(() => []),
    getNoteGtdStatus(catalogDb, noteId)
  ]);

  const childrenByParent = new Map<string, string[]>();
  for (const link of links) {
    const list = childrenByParent.get(link.parentNoteId) ?? [];
    list.push(link.childNoteId);
    childrenByParent.set(link.parentNoteId, list);
  }

  const statuses: GtdStatus[] = [];
  for (const childId of subtreeNoteIds(noteId, childrenByParent)) {
    const status = noteGtd[childId];
    if (status) statuses.push(status);
  }
  for (const link of sessionLinks) {
    if (link.noteId !== noteId) continue;
    const status = sessionGtd[sessionGtdKey(link.provider, link.sessionId)];
    if (status) statuses.push(status);
  }

  return toRollup(statuses, overrideFrom(own));
}

/** Rollups for every task (board/list use, one pass over the shared tables). */
export async function listTaskGtdRollups(
  catalogDb: string
): Promise<Record<string, TaskGtdRollup>> {
  const [noteGtd, sessionGtd, workItems, links, sessionLinks] = await Promise.all([
    loadNoteGtdMap(catalogDb),
    loadSessionGtdMap(catalogDb),
    listWorkItems(catalogDb),
    listAllNoteLinks(catalogDb).catch(() => []),
    listWorkItemSessionLinks(catalogDb).catch(() => [])
  ]);

  const childrenByParent = new Map<string, string[]>();
  for (const link of links) {
    const list = childrenByParent.get(link.parentNoteId) ?? [];
    list.push(link.childNoteId);
    childrenByParent.set(link.parentNoteId, list);
  }
  const sessionStatusesByNote = new Map<string, GtdStatus[]>();
  for (const link of sessionLinks) {
    const status = sessionGtd[sessionGtdKey(link.provider, link.sessionId)];
    if (!status) continue;
    const list = sessionStatusesByNote.get(link.noteId) ?? [];
    list.push(status);
    sessionStatusesByNote.set(link.noteId, list);
  }

  const output: Record<string, TaskGtdRollup> = {};
  for (const item of workItems) {
    const statuses: GtdStatus[] = [...(sessionStatusesByNote.get(item.noteId) ?? [])];
    for (const childId of subtreeNoteIds(item.noteId, childrenByParent)) {
      const status = noteGtd[childId];
      if (status) statuses.push(status);
    }
    output[item.noteId] = toRollup(statuses, overrideFrom(item.gtdStatus));
  }
  return output;
}
