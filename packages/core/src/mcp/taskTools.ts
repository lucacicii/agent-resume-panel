import { z } from "zod";
import { moveSessionToProjectInCatalog } from "../catalog/projects";
import { listTaskWorkbenches, listTaskWorkbenchSessionLinks } from "../catalog/taskWorkbenches";
import { GTD_STATUSES, type GtdStatus } from "../gtd/types";
import { buildNoteDocument, parseNoteDocument } from "../notes/frontmatter";
import { isWorkItemFrontmatter } from "../notes/workItemNote";
import { listTaskGtdRollups, resolveTaskGtdRollup, type TaskGtdRollup } from "../notes/gtdRollup";
import { normalizeProjectPath } from "../pathUtils";
import type { NoteToolContext } from "./tools";

/**
 * Task (work item) tools.
 *
 * A task is a note with front-matter `work: true`. It references 0..n roots
 * (multi-root repositories) through `roots`, keeps a concrete next action and an
 * owed decision, and is linked to catalog sessions through the
 * `work_item_sessions` index. Workbenches (desktop-only) hang off the task; see
 * workbenchTools.ts. "Root" is the MCP-facing name for a repository path.
 */
export interface TaskToolContext extends NoteToolContext {}

export const TASK_LIST_DEFAULT_LIMIT = 100;
export const TASK_LIST_MAX_LIMIT = 200;

const gtdStatusValues = GTD_STATUSES as unknown as [GtdStatus, ...GtdStatus[]];

export const taskListSchema = {
  gtdStatus: z
    .enum(gtdStatusValues)
    .optional()
    .describe("Filter by GTD status (inbox, next, waiting, someday, reference, done)."),
  rootPath: z
    .string()
    .optional()
    .describe("Only tasks that reference this root (declared or derived from a linked session)."),
  limit: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(`Maximum tasks to return. Defaults to ${TASK_LIST_DEFAULT_LIMIT}, capped at ${TASK_LIST_MAX_LIMIT}.`)
};

export const taskReadSchema = {
  noteId: z.string().min(1).describe("Task note id (from task_list)."),
  maxContentLength: z
    .number()
    .int()
    .min(200)
    .optional()
    .describe("Maximum Markdown characters to return. Defaults to 8000.")
};

export const taskCreateSchema = {
  title: z.string().min(1).max(200).describe("Task name."),
  next: z.string().optional().describe("Concrete next action."),
  decision: z.string().optional().describe("Decision the user still owes."),
  roots: z
    .array(z.string())
    .optional()
    .describe("Repository roots this task references (0..n). Tasks reference roots, never own them."),
  primaryRoot: z
    .string()
    .optional()
    .describe("Default root for a new session. Defaults to the first entry of roots."),
  sessions: z
    .array(z.string())
    .optional()
    .describe("Catalog session keys (`provider:id`) to link at creation."),
  gtdStatus: z.enum(gtdStatusValues).optional().describe("Initial GTD status. Defaults to inbox.")
};

export const taskWriteSchema = {
  noteId: z.string().min(1).describe("Task note id."),
  next: z.string().nullable().optional().describe("New next action; null clears it."),
  decision: z.string().nullable().optional().describe("New owed decision; null clears it."),
  roots: z
    .array(z.string())
    .optional()
    .describe("Replace the referenced roots. Pass [] to clear them."),
  primaryRoot: z
    .string()
    .nullable()
    .optional()
    .describe("New default root; null clears it."),
  gtdStatus: z.enum(gtdStatusValues).nullable().optional().describe("New GTD status; null clears it.")
};

export const taskLinkSessionSchema = {
  noteId: z.string().min(1).describe("Task note id."),
  provider: z.string().min(1).describe("Agent provider of the session (e.g. codex, claude)."),
  sessionId: z.string().min(1).describe("Catalog agent session id."),
  rootPath: z
    .string()
    .optional()
    .describe("Also reference this root from the task (and rebind the session's catalog path by default)."),
  rebindRoot: z
    .boolean()
    .optional()
    .describe("When rootPath is set, rewrite the session's catalog project path. Defaults to true.")
};

export const taskUnlinkSessionSchema = {
  noteId: z.string().min(1).describe("Task note id."),
  provider: z.string().min(1).describe("Agent provider of the session."),
  sessionId: z.string().min(1).describe("Catalog agent session id.")
};

const DEFAULT_TASK_CONTENT_LIMIT = 8000;

type TaskToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function textResult(data: unknown): TaskToolResult {
  return {
    content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }]
  };
}

function clampTaskListLimit(limit?: number): number {
  const raw = Number(limit);
  if (!Number.isFinite(raw) || raw < 1) return TASK_LIST_DEFAULT_LIMIT;
  return Math.min(Math.floor(raw), TASK_LIST_MAX_LIMIT);
}

function sessionKey(provider: string, sessionId: string): string {
  return `${provider.trim()}:${sessionId.trim()}`;
}

/** Merge the task's declared roots with roots derived from its linked sessions. */
function mergeRoots(declared: string[] | undefined, derived: string[] | undefined): string[] {
  const set = new Set<string>();
  for (const entry of [...(declared ?? []), ...(derived ?? [])]) {
    const normalized = normalizeProjectPath(entry);
    if (normalized) set.add(normalized);
  }
  return [...set];
}

async function readTaskDocument(ctx: TaskToolContext, noteId: string) {
  const note = await ctx.notesStore.getNote(noteId);
  if (!note) throw new Error(`Task not found: ${noteId}.`);
  const content = await ctx.notesStore.readNoteContent(noteId);
  const doc = parseNoteDocument(content);
  if (!isWorkItemFrontmatter(doc.frontmatter)) {
    throw new Error(`Note ${noteId} is not a task (missing front-matter work: true).`);
  }
  return { note, doc };
}

export async function handleTaskList(
  args: { gtdStatus?: GtdStatus; rootPath?: string; limit?: number },
  ctx: TaskToolContext
): Promise<TaskToolResult> {
  const limit = clampTaskListLimit(args.limit);
  const items = await ctx.notesStore.listWorkItems();
  const derived = await ctx.notesStore.listWorkItemSessionProjects();
  const rollups = ctx.catalogDb?.trim()
    ? await listTaskGtdRollups(ctx.catalogDb).catch(() => ({} as Record<string, TaskGtdRollup>))
    : ({} as Record<string, TaskGtdRollup>);
  const wanted = args.rootPath?.trim() ? normalizeProjectPath(args.rootPath) : undefined;

  const filtered = items.filter((item) => {
    if (args.gtdStatus && item.gtdStatus !== args.gtdStatus) return false;
    if (wanted) {
      const roots = mergeRoots(item.work.projects, derived[item.noteId]);
      if (!roots.includes(wanted)) return false;
    }
    return true;
  });

  const slice = filtered.slice(0, limit);
  const payload = slice.map((item) => {
    const roots = mergeRoots(item.work.projects, derived[item.noteId]);
    const rollup = rollups[item.noteId];
    return {
      noteId: item.noteId,
      title: item.title,
      gtdStatus: item.gtdStatus,
      rollupStatus: rollup?.status ?? item.gtdStatus ?? "inbox",
      pinnedStatus: rollup?.override,
      gtdCounts: rollup?.counts,
      gtdTotal: rollup?.total,
      next: item.work.next,
      decision: item.work.decision,
      roots,
      primaryRoot: item.work.primaryProject ?? roots[0],
      sessionCount: item.work.sessions?.length ?? 0,
      updatedAtMs: item.updatedAtMs
    };
  });

  if (!payload.length) {
    return textResult("No tasks found.");
  }
  return textResult(`Listed ${payload.length} task(s) of ${filtered.length}:\n${JSON.stringify(payload, null, 2)}`);
}

export async function handleTaskRead(
  args: { noteId: string; maxContentLength?: number },
  ctx: TaskToolContext
): Promise<TaskToolResult> {
  const { note, doc } = await readTaskDocument(ctx, args.noteId);
  const sessions = await ctx.notesStore.listWorkItemSessionDetails(note.noteId);
  const workbenches = await listTaskWorkbenches(ctx.dbPath, note.noteId).catch(() => []);
  const derived = await ctx.notesStore.listWorkItemSessionProjects();
  const rollup = ctx.catalogDb?.trim()
    ? await resolveTaskGtdRollup(ctx.catalogDb, note.noteId).catch(() => undefined)
    : undefined;
  const roots = mergeRoots(doc.frontmatter.projects, derived[note.noteId]);
  const limit = Math.max(200, Math.floor(Number(args.maxContentLength) || DEFAULT_TASK_CONTENT_LIMIT));
  const content = doc.body;
  const truncated = content.length > limit;
  return textResult({
    noteId: note.noteId,
    title: note.title,
    gtdStatus: note.gtdStatus,
    rollupStatus: rollup?.status ?? note.gtdStatus ?? "inbox",
    pinnedStatus: rollup?.override,
    gtdCounts: rollup?.counts,
    gtdTotal: rollup?.total,
    work: {
      next: doc.frontmatter.next,
      decision: doc.frontmatter.decision,
      roots,
      primaryRoot: doc.frontmatter.primaryProject ?? roots[0],
      sessions: doc.frontmatter.sessions ?? []
    },
    linkedSessions: sessions.map((session) => ({
      provider: session.provider,
      sessionId: session.sessionId,
      rootPath: session.projectPath
    })),
    workbenches: workbenches.map((wb) => ({
      workbenchId: wb.workbenchId,
      name: wb.name,
      rootPath: wb.projectPath,
      position: wb.position
    })),
    content: truncated ? content.slice(0, limit) : content,
    truncated,
    totalLength: content.length
  });
}

export async function handleTaskCreate(
  args: {
    title: string;
    next?: string;
    decision?: string;
    roots?: string[];
    primaryRoot?: string;
    sessions?: string[];
    gtdStatus?: GtdStatus;
  },
  ctx: TaskToolContext
): Promise<TaskToolResult> {
  const title = args.title?.trim();
  if (!title) throw new Error("title is required.");
  const record = await ctx.notesStore.createWorkItem({
    title,
    next: args.next?.trim() || undefined,
    decision: args.decision?.trim() || undefined,
    projects: args.roots?.map((entry) => entry.trim()).filter(Boolean),
    primaryProject: args.primaryRoot?.trim() || undefined,
    sessions: args.sessions?.map((entry) => entry.trim()).filter(Boolean)
  });
  await ctx.notesStore.setNoteGtdStatus(record.noteId, args.gtdStatus ?? "inbox");
  return textResult({
    ok: true,
    noteId: record.noteId,
    title: record.title,
    gtdStatus: args.gtdStatus ?? "inbox"
  });
}

export async function handleTaskWrite(
  args: {
    noteId: string;
    next?: string | null;
    decision?: string | null;
    roots?: string[];
    primaryRoot?: string | null;
    gtdStatus?: GtdStatus | null;
  },
  ctx: TaskToolContext
): Promise<TaskToolResult> {
  const { doc } = await readTaskDocument(ctx, args.noteId);
  const fm = { ...doc.frontmatter };

  if (args.next !== undefined) {
    const value = args.next?.trim();
    if (value) fm.next = value;
    else delete fm.next;
  }
  if (args.decision !== undefined) {
    const value = args.decision?.trim();
    if (value) fm.decision = value;
    else delete fm.decision;
  }
  if (args.roots !== undefined) {
    const roots = args.roots.map((entry) => normalizeProjectPath(entry)).filter(Boolean);
    if (roots.length) fm.projects = roots;
    else delete fm.projects;
  }
  if (args.primaryRoot !== undefined) {
    const value = args.primaryRoot?.trim();
    if (value) fm.primaryProject = normalizeProjectPath(value);
    else delete fm.primaryProject;
  }

  await ctx.notesStore.writeNoteContent(args.noteId, buildNoteDocument(fm, doc.body));

  if (args.gtdStatus !== undefined) {
    if (args.gtdStatus) await ctx.notesStore.setNoteGtdStatus(args.noteId, args.gtdStatus);
    else await ctx.notesStore.clearNoteGtdStatus(args.noteId);
  }

  const updated = await ctx.notesStore.getNote(args.noteId);
  return textResult({
    ok: true,
    noteId: args.noteId,
    work: {
      next: fm.next,
      decision: fm.decision,
      roots: fm.projects ?? [],
      primaryRoot: fm.primaryProject
    },
    gtdStatus: updated?.gtdStatus
  });
}

export async function handleTaskLinkSession(
  args: { noteId: string; provider: string; sessionId: string; rootPath?: string; rebindRoot?: boolean },
  ctx: TaskToolContext
): Promise<TaskToolResult> {
  const provider = args.provider?.trim();
  const sessionId = args.sessionId?.trim();
  if (!provider || !sessionId) throw new Error("provider and sessionId are required.");
  const key = sessionKey(provider, sessionId);
  const { doc } = await readTaskDocument(ctx, args.noteId);
  const fm = { ...doc.frontmatter };

  const sessions = new Set(fm.sessions ?? []);
  sessions.add(key);
  fm.sessions = [...sessions];

  const referenceable = args.rootPath?.trim() ? normalizeProjectPath(args.rootPath) : undefined;
  if (referenceable) {
    const roots = new Set((fm.projects ?? []).map((entry) => normalizeProjectPath(entry)));
    roots.add(referenceable);
    fm.projects = [...roots];
    if (!fm.primaryProject) fm.primaryProject = referenceable;
  }

  await ctx.notesStore.writeNoteContent(args.noteId, buildNoteDocument(fm, doc.body));

  let rebind: unknown;
  let rebindError: string | undefined;
  if (referenceable && args.rebindRoot !== false) {
    if (!ctx.catalogDb?.trim()) {
      rebindError = "catalogDb is not configured; the session's catalog path was not rewritten.";
    } else {
      try {
        rebind = await moveSessionToProjectInCatalog(ctx.catalogDb, provider, sessionId, referenceable);
      } catch (error) {
        rebindError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  return textResult({
    ok: true,
    noteId: args.noteId,
    sessionKey: key,
    rootPath: referenceable,
    rebind,
    rebindError
  });
}

export async function handleTaskUnlinkSession(
  args: { noteId: string; provider: string; sessionId: string },
  ctx: TaskToolContext
): Promise<TaskToolResult> {
  const provider = args.provider?.trim();
  const sessionId = args.sessionId?.trim();
  if (!provider || !sessionId) throw new Error("provider and sessionId are required.");
  const key = sessionKey(provider, sessionId);
  const { doc } = await readTaskDocument(ctx, args.noteId);
  const fm = { ...doc.frontmatter };

  const sessions = (fm.sessions ?? []).filter((entry) => entry !== key);
  if (sessions.length) fm.sessions = sessions;
  else delete fm.sessions;

  await ctx.notesStore.writeNoteContent(args.noteId, buildNoteDocument(fm, doc.body));
  return textResult({ ok: true, noteId: args.noteId, sessionKey: key, removed: true });
}
