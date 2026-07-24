import { z } from "zod";
import type { NoteRecord } from "../notes/catalogNotes";
import {
  appendNoteGtdTask,
  deleteNoteGtdTask,
  parseNoteGtdTasks,
  updateNoteGtdTask,
  type NoteGtdTask
} from "../notes/gtd";
import { isGtdStatus, type GtdStatus } from "../gtd/types";
import { assertNoteWritable, type NoteToolContext } from "./tools";

const statusSchema = z.enum(["inbox", "next", "waiting", "someday", "reference", "done"]);

export const noteGtdListSchema = {
  query: z.string().min(1).optional().describe("Optional keyword matched against task text and note metadata."),
  status: statusSchema.optional().describe("Optional GTD status filter."),
  noteId: z.string().min(1).optional().describe("Optional source note filter."),
  limit: z.number().int().min(1).max(200).optional().describe("Maximum tasks to return. Defaults to 100.")
};

export const noteGtdCreateSchema = {
  noteId: z.string().min(1).describe("The note that will contain the new task."),
  text: z.string().min(1).max(2000).describe("Task text written inside the note's :::gtd block."),
  status: statusSchema.optional().describe("GTD status. Defaults to next.")
};

export const noteGtdUpdateSchema = {
  noteId: z.string().min(1).describe("The note containing the task."),
  taskText: z.string().min(1).describe("Existing task text from the :::gtd block."),
  occurrence: z.number().int().min(1).optional().describe("Required when the same task text appears more than once in the note."),
  text: z.string().min(1).max(2000).optional().describe("Replacement text for the :::gtd block."),
  status: statusSchema.optional().describe("Replacement GTD status. Use done to complete a task.")
};

export const noteGtdDeleteSchema = {
  noteId: z.string().min(1).describe("The note containing the task."),
  taskText: z.string().min(1).describe("Task text to remove from a :::gtd block."),
  occurrence: z.number().int().min(1).optional().describe("Required when the same task text appears more than once in the note.")
};

interface GtdSummary extends NoteGtdTask {
  noteId: string;
  title: string;
  scope: string;
  relMdPath: string;
  projectPath?: string;
}

function summary(record: NoteRecord, task: NoteGtdTask): GtdSummary {
  return {
    ...task,
    noteId: record.noteId,
    title: record.title || record.filename,
    scope: record.scope,
    relMdPath: record.relMdPath,
    projectPath: record.projectPath
  };
}

async function loadRecord(ctx: NoteToolContext, noteId: string): Promise<NoteRecord> {
  const record = await ctx.notesStore.getNote(noteId);
  if (!record) throw new Error(`Note not found: ${noteId}`);
  return record;
}

function result(label: string, value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: `${label}\n${JSON.stringify(value, null, 2)}` }] };
}

export async function handleNoteGtdList(
  args: { query?: string; status?: string; noteId?: string; limit?: number },
  ctx: NoteToolContext
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  await ctx.notesStore.reload();
  const query = args.query?.trim().toLocaleLowerCase() || "";
  const status = args.status && isGtdStatus(args.status) ? args.status : undefined;
  const limit = Math.min(args.limit || 100, 200);
  const tasks: GtdSummary[] = [];
  for (const record of ctx.notesStore.getAllNotes()) {
    if (args.noteId && record.noteId !== args.noteId) continue;
    try {
      const content = await ctx.notesStore.readNoteContent(record.noteId);
      for (const task of parseNoteGtdTasks(content)) {
        const item = summary(record, task);
        const searchable = `${item.text} ${item.title} ${item.relMdPath} ${item.projectPath || ""} ${item.status}`.toLocaleLowerCase();
        if ((!status || item.status === status) && (!query || searchable.includes(query))) {
          tasks.push(item);
        }
      }
    } catch {
      // One unreadable user-owned note must not block the remaining GTD list.
    }
  }
  return result(`Found ${tasks.length} GTD task(s).`, tasks.slice(0, limit));
}

export async function handleNoteGtdCreate(
  args: { noteId: string; text: string; status?: GtdStatus },
  ctx: NoteToolContext
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const record = await loadRecord(ctx, args.noteId);
  await assertNoteWritable(ctx, args.noteId);
  const content = await ctx.notesStore.readNoteContent(record.noteId);
  const next = appendNoteGtdTask(content, args);
  await ctx.notesStore.writeNoteContent(record.noteId, next);
  const task = parseNoteGtdTasks(next).at(-1);
  return result("GTD task created.", task ? summary(record, task) : { noteId: record.noteId });
}

export async function handleNoteGtdUpdate(
  args: { noteId: string; taskText: string; occurrence?: number; text?: string; status?: GtdStatus },
  ctx: NoteToolContext
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const record = await loadRecord(ctx, args.noteId);
  await assertNoteWritable(ctx, args.noteId);
  const content = await ctx.notesStore.readNoteContent(record.noteId);
  const next = updateNoteGtdTask(content, args);
  await ctx.notesStore.writeNoteContent(record.noteId, next);
  const text = (args.text || args.taskText).replace(/\s+/g, " ").trim();
  const task = parseNoteGtdTasks(next).find((item) => item.text === text && (args.occurrence == null || item.occurrence === args.occurrence));
  return result("GTD task updated.", task ? summary(record, task) : { noteId: record.noteId });
}

export async function handleNoteGtdDelete(
  args: { noteId: string; taskText: string; occurrence?: number },
  ctx: NoteToolContext
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const record = await loadRecord(ctx, args.noteId);
  await assertNoteWritable(ctx, args.noteId);
  const content = await ctx.notesStore.readNoteContent(record.noteId);
  const task = parseNoteGtdTasks(content).find((item) => item.text === args.taskText && (args.occurrence == null || item.occurrence === args.occurrence));
  const next = deleteNoteGtdTask(content, args);
  await ctx.notesStore.writeNoteContent(record.noteId, next);
  return result("GTD task deleted.", task ? summary(record, task) : { noteId: record.noteId });
}
