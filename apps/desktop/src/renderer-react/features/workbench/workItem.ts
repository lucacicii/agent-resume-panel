import type { GtdStatus, NoteWorkFields } from "@agent-resume/core";

/**
 * One work item as the renderer navigates and scopes it.
 *
 * This is the authoritative shape for both the Workbench sidebar list and the
 * `agent-resume:workbench-work-item` payload, so producers and consumers cannot
 * drift apart silently. Keep it in this neutral module rather than in a
 * component file.
 */
export type WorkbenchWorkItem = {
  noteId: string;
  title: string;
  status: GtdStatus;
  next?: string;
  decision?: string;
  /** Session keys (`provider:id`) this work item is implemented through. */
  sessions: string[];
  /** Projects this work item references (0..n). */
  projects?: string[];
  primaryProject?: string;
  updatedAtMs?: number;
};

/**
 * The fields {@link workItemFromRecord} reads. Declared structurally because the
 * preload API returns its own structural copy of the note record rather than
 * importing the core type.
 */
export type WorkItemSource = {
  noteId: string;
  title?: string;
  filename: string;
  gtdStatus?: GtdStatus;
  updatedAtMs: number;
  work?: NoteWorkFields;
};

/** Normalize a catalog note/work item record into the renderer shape. */
export function workItemFromRecord(record: WorkItemSource): WorkbenchWorkItem {
  return {
    noteId: record.noteId,
    title: record.title || record.filename.replace(/\.md$/i, "") || record.noteId,
    status: record.gtdStatus ?? "inbox",
    next: record.work?.next,
    decision: record.work?.decision,
    sessions: record.work?.sessions ?? [],
    projects: record.work?.projects,
    primaryProject: record.work?.primaryProject,
    updatedAtMs: record.updatedAtMs
  };
}
