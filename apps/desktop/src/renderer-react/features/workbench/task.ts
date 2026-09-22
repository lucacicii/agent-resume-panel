import type { GtdStatus, NoteWorkFields } from "@agent-resume/core";
import type { TaskAccent } from "../../../shared/taskColors";

/**
 * One task as the renderer navigates and scopes it.
 *
 * This is the authoritative shape for both the Workbench sidebar list and the
 * `agent-resume:workbench-task` payload, so producers and consumers cannot
 * drift apart silently. Keep it in this neutral module rather than in a
 * component file.
 */
export type WorkbenchTask = {
  noteId: string;
  title: string;
  status: GtdStatus;
  next?: string;
  decision?: string;
  /** Session keys (`provider:id`) this task is implemented through. */
  sessions: string[];
  /** Projects this task references (0..n). */
  projects?: string[];
  primaryProject?: string;
  /** The template this task was created from, when it has one. */
  templateId?: string;
  /** Template-derived accent driving the window's color family. */
  accent?: TaskAccent;
  updatedAtMs?: number;
  /** Present only for archived tasks; the archive timestamp in ms. */
  archivedAtMs?: number;
};

/**
 * The fields {@link taskFromRecord} reads. Declared structurally because the
 * preload API returns its own structural copy of the note record rather than
 * importing the core type.
 */
export type TaskSource = {
  noteId: string;
  title?: string;
  filename: string;
  gtdStatus?: GtdStatus;
  updatedAtMs: number;
  archivedAtMs?: number;
  work?: NoteWorkFields;
  accent?: TaskAccent;
  templateId?: string;
};

/** Normalize a catalog note/task record into the renderer shape. */
export function taskFromRecord(record: TaskSource): WorkbenchTask {
  return {
    noteId: record.noteId,
    title: record.title || record.filename.replace(/\.md$/i, "") || record.noteId,
    status: record.gtdStatus ?? "inbox",
    next: record.work?.next,
    decision: record.work?.decision,
    sessions: record.work?.sessions ?? [],
    projects: record.work?.projects,
    primaryProject: record.work?.primaryProject,
    templateId: record.templateId,
    accent: record.accent,
    updatedAtMs: record.updatedAtMs,
    archivedAtMs: record.archivedAtMs
  };
}
