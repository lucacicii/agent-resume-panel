import { z } from "zod";
import type { NotesStore } from "../notes/store";
import type { NoteRecord } from "../notes/catalogNotes";
import type { AgentProvider } from "../catalog/types";

export interface NoteToolContext {
  notesStore: NotesStore;
  dbPath: string;
}

function summarizeNote(record: NoteRecord): Record<string, unknown> {
  return {
    noteId: record.noteId,
    title: record.title || record.filename,
    scope: record.scope,
    relMdPath: record.relMdPath,
    contentPreview: record.contentPreview,
    provider: record.provider,
    agentSessionId: record.agentSessionId,
    projectPath: record.projectPath,
    updatedAtMs: record.updatedAtMs
  };
}

// --- Schemas ---

export const noteSearchSchema = {
  query: z.string().min(1).describe("Search query — matched against note titles, content previews, and filenames."),
  scope: z
    .enum(["library", "project", "session", "all"])
    .optional()
    .describe("Filter by note scope. Defaults to 'all'."),
  limit: z.number().int().min(1).max(50).optional().describe("Maximum notes to return. Defaults to 10.")
};

export const noteCreateSchema = {
  scope: z.enum(["library", "project", "session"]).describe("Where to create the note."),
  title: z.string().min(1).max(200).describe("Note title — used as the first heading."),
  body: z.string().max(20000).optional().describe("Markdown body content (excluding the title heading)."),
  projectPath: z
    .string()
    .optional()
    .describe("Required when scope is 'project'. Absolute project directory path."),
  provider: z
    .enum(["codex", "claude", "gemini", "cursor", "windsurf", "copilot", "opencode", "almadesk"])
    .optional()
    .describe("Required when scope is 'session'. The agent provider."),
  sessionId: z.string().optional().describe("Required when scope is 'session'. The agent session ID.")
};

export const noteReadSchema = {
  noteId: z.string().min(1).describe("The noteId of the note to read."),
  maxLength: z.number().int().min(100).max(20000).optional().describe("Maximum characters of content to return. Defaults to 5000.")
};

export const noteWriteSchema = {
  noteId: z.string().min(1).describe("The noteId of the note to overwrite."),
  content: z.string().min(1).max(20000).describe("Full markdown content to replace the note with (including the title heading).")
};

export const noteAppendSchema = {
  noteId: z.string().min(1).describe("The noteId of the note to append to."),
  content: z.string().min(1).max(10000).describe("Markdown content to append to the end of the note.")
};

export const noteDeleteSchema = {
  noteId: z.string().min(1).describe("The noteId of the note to delete.")
};

// --- Handlers ---

export async function handleNoteSearch(
  args: { query: string; scope?: string; limit?: number },
  ctx: NoteToolContext
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const store = ctx.notesStore;
  await store.reload();
  const all = store.getAllNotes();
  const scope = args.scope || "all";
  const limit = args.limit || 10;

  let filtered = all;
  if (scope !== "all") {
    filtered = all.filter((n) => n.scope === scope);
  }

  const queryLower = args.query.toLowerCase();
  const matched = filtered
    .filter((n) => {
      const title = (n.title || "").toLowerCase();
      const preview = (n.contentPreview || "").toLowerCase();
      const filename = (n.filename || "").toLowerCase();
      return title.includes(queryLower) || preview.includes(queryLower) || filename.includes(queryLower);
    })
    .slice(0, limit);

  const summary = matched.map(summarizeNote);
  const text =
    matched.length === 0
      ? `No notes found matching "${args.query}".`
      : `Found ${matched.length} note(s) matching "${args.query}":\n${JSON.stringify(summary, null, 2)}`;

  return { content: [{ type: "text", text }] };
}

export async function handleNoteCreate(
  args: {
    scope: "library" | "project" | "session";
    title: string;
    body?: string;
    projectPath?: string;
    provider?: string;
    sessionId?: string;
  },
  ctx: NoteToolContext
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const store = ctx.notesStore;
  const heading = `# ${args.title}`;
  const body = args.body ? `${heading}\n\n${args.body}` : heading;

  let record: NoteRecord;

  if (args.scope === "library") {
    record = await store.createLibraryNote(body);
  } else if (args.scope === "project") {
    if (!args.projectPath?.trim()) {
      throw new Error("projectPath is required for scope 'project'.");
    }
    record = await store.createProjectNote(args.projectPath, body);
  } else {
    if (!args.provider?.trim() || !args.sessionId?.trim()) {
      throw new Error("provider and sessionId are required for scope 'session'.");
    }
    record = await store.createSessionNote(
      {
        provider: args.provider as AgentProvider,
        id: args.sessionId,
        projectPath: args.projectPath || ""
      },
      body
    );
  }

  const summary = summarizeNote(record);
  const text = `Note created successfully.\n${JSON.stringify(summary, null, 2)}`;
  return { content: [{ type: "text", text }] };
}

export async function handleNoteRead(
  args: { noteId: string; maxLength?: number },
  ctx: NoteToolContext
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const store = ctx.notesStore;
  const record = await store.getNote(args.noteId);
  if (!record) {
    throw new Error(`Note not found: ${args.noteId}`);
  }
  const content = await store.readNoteContent(args.noteId);
  const maxLen = args.maxLength || 5000;
  const truncated = content.length > maxLen ? `${content.slice(0, maxLen)}\n[...truncated ${content.length - maxLen} chars...]` : content;
  const text = `${JSON.stringify(summarizeNote(record), null, 2)}\n\n---\n${truncated}`;
  return { content: [{ type: "text", text }] };
}

export async function handleNoteWrite(
  args: { noteId: string; content: string },
  ctx: NoteToolContext
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const store = ctx.notesStore;
  const before = await store.getNote(args.noteId);
  if (!before) {
    throw new Error(`Note not found: ${args.noteId}`);
  }
  const record = await store.writeNoteContent(args.noteId, args.content);
  const text = `Note overwritten successfully.\n${JSON.stringify(summarizeNote(record), null, 2)}`;
  return { content: [{ type: "text", text }] };
}

export async function handleNoteAppend(
  args: { noteId: string; content: string },
  ctx: NoteToolContext
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const store = ctx.notesStore;
  const before = await store.getNote(args.noteId);
  if (!before) {
    throw new Error(`Note not found: ${args.noteId}`);
  }
  const existing = await store.readNoteContent(args.noteId);
  const newContent = `${existing}\n\n${args.content}`;
  const record = await store.writeNoteContent(args.noteId, newContent);
  const text = `Content appended successfully.\n${JSON.stringify(summarizeNote(record), null, 2)}`;
  return { content: [{ type: "text", text }] };
}

export async function handleNoteDelete(
  args: { noteId: string },
  ctx: NoteToolContext
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const store = ctx.notesStore;
  const before = await store.getNote(args.noteId);
  if (!before) {
    throw new Error(`Note not found: ${args.noteId}`);
  }
  const summary = summarizeNote(before);
  await store.deleteNote(args.noteId);
  const text = `Note deleted.\n${JSON.stringify(summary, null, 2)}`;
  return { content: [{ type: "text", text }] };
}
