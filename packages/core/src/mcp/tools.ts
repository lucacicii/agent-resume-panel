import { z } from "zod";
import type { NotesStore } from "../notes/store";
import type { NoteRecord } from "../notes/catalogNotes";
import type { AgentProvider } from "../catalog/types";
import {
  buildNoteDocument,
  parseNoteDocument,
  type NoteFrontmatter
} from "../notes/frontmatter";
import {
  deleteLinksForNote,
  listAllNoteLinks,
  type NoteLink
} from "../notes/links";
import { planNoteSearchDeterministically } from "../notes/queryPlan";
import { searchNotesByEmbedding } from "../notes/search";
import type { NoteOwner } from "../notes/paths";
import { normalizeProjectPath } from "../pathUtils";

export interface NoteToolContext {
  notesStore: NotesStore;
  /** Desktop DB path for report tools; notes and links live in catalogDb. */
  dbPath: string;
  catalogDb?: string;
}

export const NOTE_SEARCH_DEFAULT_LIMIT = 50;
export const NOTE_SEARCH_MAX_LIMIT = 200;
export const NOTE_LIST_DEFAULT_LIMIT = 100;
export const NOTE_LIST_MAX_LIMIT = 200;
export const NOTE_TREE_DEFAULT_MAX_NODES = 100;
export const NOTE_TREE_MAX_NODES = 200;

const providerSchema = z.enum([
  "codex",
  "claude",
  "agy",
  "grok",
  "opencode",
  "pi",
  "cursor",
  "cursor-ide",
  "chat"
]);

export type NoteMcpResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export function clampNoteSearchLimit(limit?: number): number {
  const raw = Number(limit);
  if (!Number.isFinite(raw) || raw < 1) {
    return NOTE_SEARCH_DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(raw), NOTE_SEARCH_MAX_LIMIT);
}

export function noteResponse(message: string, data: Record<string, unknown> = {}): NoteMcpResult {
  // Keep the human-readable prefix for existing clients while making the JSON
  // payload a stable, machine-readable envelope. Data is flattened for
  // backwards compatibility with the old note_list response shape.
  const payload = { ok: true, message, ...data };
  return {
    content: [{ type: "text", text: `${message}\n${JSON.stringify(payload, null, 2)}` }]
  };
}

function noteErrorCode(message: string): string {
  if (/not found/i.test(message)) return "NOTE_NOT_FOUND";
  if (/required|invalid|cannot|must be|only be used/i.test(message)) return "NOTE_VALIDATION";
  if (/cycle|already exists|conflict/i.test(message)) return "NOTE_CONFLICT";
  return "NOTE_OPERATION_FAILED";
}

export async function runNoteTool(operation: () => Promise<NoteMcpResult>): Promise<NoteMcpResult> {
  try {
    return await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      isError: true,
      content: [{
        type: "text",
        text: `Error: ${message}\n${JSON.stringify({
          ok: false,
          message: "Note operation failed.",
          error: { code: noteErrorCode(message), message }
        }, null, 2)}`
      }]
    };
  }
}

function summarizeOwner(record: NoteRecord): NoteOwner {
  if (record.scope === "library") {
    return { scope: "library" };
  }
  if (record.scope === "project") {
    return { scope: "project", projectPath: record.projectPath || "" };
  }
  return {
    scope: "session",
    provider: (record.provider || "") as AgentProvider,
    sessionId: record.agentSessionId || "",
    projectPath: record.projectPath
  };
}

export interface NoteRelationshipIndex {
  parentByChild: Map<string, string>;
  childrenByParent: Map<string, string[]>;
}

function relationshipIndex(links: NoteLink[]): NoteRelationshipIndex {
  const parentByChild = new Map<string, string>();
  const childrenByParent = new Map<string, string[]>();
  for (const link of links) {
    parentByChild.set(link.childNoteId, link.parentNoteId);
    const children = childrenByParent.get(link.parentNoteId) || [];
    children.push(link.childNoteId);
    childrenByParent.set(link.parentNoteId, children);
  }
  return { parentByChild, childrenByParent };
}

function rootFor(noteId: string, index: NoteRelationshipIndex): string {
  const seen = new Set<string>();
  let current = noteId;
  while (index.parentByChild.has(current) && !seen.has(current)) {
    seen.add(current);
    current = index.parentByChild.get(current)!;
  }
  return current;
}

export function summarizeNote(
  record: NoteRecord,
  index?: NoteRelationshipIndex
): Record<string, unknown> {
  const parentNoteId = index?.parentByChild.get(record.noteId);
  const childCount = index?.childrenByParent.get(record.noteId)?.length || 0;
  return {
    noteId: record.noteId,
    title: record.title || record.filename,
    filename: record.filename,
    scope: record.scope,
    owner: summarizeOwner(record),
    relDir: record.relDir,
    relMdPath: record.relMdPath,
    contentPreview: record.contentPreview,
    provider: record.provider,
    agentSessionId: record.agentSessionId,
    projectPath: record.projectPath,
    createdAtMs: record.createdAtMs,
    updatedAtMs: record.updatedAtMs,
    link: {
      parentNoteId,
      rootNoteId: rootFor(record.noteId, index || { parentByChild: new Map(), childrenByParent: new Map() }),
      childCount,
      isRoot: !parentNoteId
    }
  };
}

async function loadRelationshipIndex(ctx: NoteToolContext): Promise<NoteRelationshipIndex> {
  try {
    return relationshipIndex(await listAllNoteLinks(ctx.catalogDb || ctx.dbPath));
  } catch {
    // Older in-process callers only provide a desktop DB path. Notes are still
    // usable there; relationship metadata simply falls back to a root-only view.
    return { parentByChild: new Map(), childrenByParent: new Map() };
  }
}

function noteMatchesQuery(note: NoteRecord, queryLower: string): boolean {
  const fields = [
    note.title,
    note.contentPreview,
    note.filename,
    note.relMdPath,
    note.relDir,
    note.projectPath,
    note.provider,
    note.agentSessionId
  ];
  return fields.some((value) => value && value.toLowerCase().includes(queryLower));
}

function matchesOwnerFilters(
  note: NoteRecord,
  args: { scope?: string; projectPath?: string; provider?: string; sessionId?: string }
): boolean {
  if (args.scope && args.scope !== "all" && note.scope !== args.scope) return false;
  if (args.projectPath && note.projectPath !== normalizeProjectPath(args.projectPath)) return false;
  if (args.provider && note.provider !== args.provider) return false;
  if (args.sessionId && note.agentSessionId !== args.sessionId) return false;
  return true;
}

function fallbackNoteSearch(
  notes: NoteRecord[],
  query: string,
  args: { scope?: string; projectPath?: string; provider?: string; sessionId?: string },
  limit: number,
  index: NoteRelationshipIndex
): { summary: Record<string, unknown>[]; totalMatches: number } {
  const queryLower = query.toLowerCase();
  const matched = notes.filter(
    (note) => matchesOwnerFilters(note, args) && noteMatchesQuery(note, queryLower)
  );
  return {
    summary: matched.slice(0, limit).map((note) => summarizeNote(note, index)),
    totalMatches: matched.length
  };
}

function parseBodyForWrite(input: string, existing: string): { frontmatter: NoteFrontmatter; body: string } {
  const current = parseNoteDocument(existing);
  const submitted = parseNoteDocument(input);
  // MCP callers may send either a body or a complete Markdown document. The
  // catalog-owned identity and owner always come from the existing document.
  return { frontmatter: current.frontmatter, body: submitted.body };
}

function ownerFromArgs(args: {
  scope: "library" | "project" | "session";
  projectPath?: string;
  provider?: string;
  sessionId?: string;
}): NoteOwner {
  if (args.scope === "library") return { scope: "library" };
  if (args.scope === "project") {
    if (!args.projectPath?.trim()) throw new Error("projectPath is required for scope 'project'.");
    return { scope: "project", projectPath: args.projectPath };
  }
  if (!args.provider?.trim() || !args.sessionId?.trim()) {
    throw new Error("provider and sessionId are required for scope 'session'.");
  }
  return {
    scope: "session",
    provider: args.provider as AgentProvider,
    sessionId: args.sessionId,
    projectPath: args.projectPath || ""
  };
}

// --- Schemas ---

const ownerFilters = {
  scope: z.enum(["library", "project", "session", "all"]).optional().describe("Filter by note scope. Defaults to 'all'."),
  projectPath: z.string().optional().describe("Filter by normalized project path."),
  provider: providerSchema.optional().describe("Filter session notes by provider."),
  sessionId: z.string().optional().describe("Filter session notes by agent session ID.")
};

export const noteSearchSchema = {
  query: z.string().min(1).describe("Search query matched against note metadata, indexed content, filenames, paths, and session identity."),
  ...ownerFilters,
  limit: z.number().int().min(1).optional().describe(`Maximum notes to return. Defaults to ${NOTE_SEARCH_DEFAULT_LIMIT}, capped at ${NOTE_SEARCH_MAX_LIMIT}.`)
};

export const noteListSchema = {
  ...ownerFilters,
  rootOnly: z.boolean().optional().describe("Return only notes without a parent link."),
  parentNoteId: z.string().min(1).optional().describe("Return direct children of this parent note."),
  limit: z.number().int().min(1).max(NOTE_LIST_MAX_LIMIT).optional().describe(`Maximum notes per page. Defaults to ${NOTE_LIST_DEFAULT_LIMIT}.`),
  cursor: z.number().int().min(0).optional().describe("Zero-based offset returned as nextCursor from a previous note_list call.")
};

export const noteCreateSchema = {
  scope: z.enum(["library", "project", "session"]).optional().describe("Where to create the note; optional when parentNoteId is provided."),
  title: z.string().min(1).max(200).describe("Note title — used as the first heading."),
  body: z.string().max(20000).optional().describe("Markdown body content excluding the title heading."),
  parentNoteId: z.string().min(1).optional().describe("Create as a linked child of this Project Note; owner is inferred from the parent."),
  projectPath: z.string().optional().describe("Required for project scope; ignored only when parentNoteId supplies the owner."),
  provider: providerSchema.optional().describe("Required for session scope."),
  sessionId: z.string().optional().describe("Required for session scope.")
};

export const noteReadSchema = {
  noteId: z.string().min(1).describe("The noteId of the note to read."),
  maxLength: z.number().int().min(100).max(20000).optional().describe("Maximum characters of raw Markdown content to return. Defaults to 5000.")
};

export const noteWriteSchema = {
  noteId: z.string().min(1).describe("The noteId of the note to overwrite."),
  content: z.string().min(1).max(20000).describe("Markdown body or complete Markdown document. Managed frontmatter is preserved from the existing note.")
};

export const noteAppendSchema = {
  noteId: z.string().min(1).describe("The noteId of the note to append to."),
  content: z.string().min(1).max(10000).describe("Markdown content to append to the body of the note.")
};

export const noteDeleteSchema = {
  noteId: z.string().min(1).describe("The noteId of the note to delete.")
};

export const noteTreeReadSchema = {
  noteId: z.string().min(1).describe("Any note in the association tree; its root is resolved automatically."),
  maxNodes: z.number().int().min(1).max(NOTE_TREE_MAX_NODES).optional().describe(`Maximum tree nodes. Defaults to ${NOTE_TREE_DEFAULT_MAX_NODES}.`)
};

export const noteSetParentSchema = {
  noteId: z.string().min(1).describe("Project Note whose parent should change."),
  parentNoteId: z.string().min(1).nullable().describe("New parent Project Note ID, or null to make the note a root.")
};

export const noteMoveSchema = {
  noteId: z.string().min(1).describe("The noteId to move."),
  scope: z.enum(["library", "project", "session"]).describe("Destination owner scope."),
  projectPath: z.string().optional().describe("Required for project scope."),
  provider: providerSchema.optional().describe("Required for session scope."),
  sessionId: z.string().optional().describe("Required for session scope.")
};

export const noteRenameSchema = {
  noteId: z.string().min(1).describe("The noteId to rename."),
  filename: z.string().min(1).max(200).describe("New Markdown filename. Asset directories and relative references are updated automatically.")
};

// --- Handlers ---

export async function handleNoteSearch(
  args: { query: string; scope?: string; projectPath?: string; provider?: string; sessionId?: string; limit?: number },
  ctx: NoteToolContext
): Promise<NoteMcpResult> {
  const store = ctx.notesStore;
  await store.reload();
  const query = args.query?.trim();
  if (!query) throw new Error("query is required.");
  const limit = clampNoteSearchLimit(args.limit);
  const index = await loadRelationshipIndex(ctx);
  const plan = planNoteSearchDeterministically(query);

  try {
    let hits = await searchNotesByEmbedding({ panelHome: store.getPanelHome(), query, limit, plan });
    hits = hits.filter((hit) => {
      const note = store.getAllNotes().find((item) => item.noteId === hit.noteId);
      return note ? matchesOwnerFilters(note, args) : false;
    });
    const totalMatches = hits[0]?.exactMatchTotal ?? hits.length;
    const items = hits.map((hit) => ({
      ...summarizeNote(store.getAllNotes().find((note) => note.noteId === hit.noteId) || {
        noteId: hit.noteId,
        title: hit.title,
        scope: hit.scope,
        relMdPath: hit.relMdPath,
        projectPath: hit.projectPath,
        contentPreview: hit.content.slice(0, 240),
        filename: hit.relMdPath.split("/").pop() || hit.noteId,
        relDir: "",
        createdAtMs: 0,
        updatedAtMs: 0
      } as NoteRecord, index),
      matchType: hit.matchType,
      matchedTerms: hit.matchedTerms
    }));
    const message = items.length
      ? `Found ${totalMatches} note(s) matching "${query}"${totalMatches > items.length ? `; showing first ${items.length}` : ""}.`
      : `No notes found matching "${query}".`;
    return noteResponse(message, { query, total: totalMatches, items });
  } catch {
    const { summary, totalMatches } = fallbackNoteSearch(store.getAllNotes(), query, args, limit, index);
    const message = summary.length
      ? `Found ${totalMatches} note(s) matching "${query}"${totalMatches > summary.length ? `; showing first ${summary.length}` : ""}.`
      : `No notes found matching "${query}".`;
    return noteResponse(message, { query, total: totalMatches, items: summary });
  }
}

export async function handleNoteList(
  args: { scope?: string; projectPath?: string; provider?: string; sessionId?: string; rootOnly?: boolean; parentNoteId?: string; limit?: number; cursor?: number },
  ctx: NoteToolContext
): Promise<NoteMcpResult> {
  await ctx.notesStore.reload();
  const index = await loadRelationshipIndex(ctx);
  const scope = args.scope || "all";
  const limit = Math.min(Math.max(args.limit || NOTE_LIST_DEFAULT_LIMIT, 1), NOTE_LIST_MAX_LIMIT);
  const cursor = Math.max(args.cursor || 0, 0);
  const notes = ctx.notesStore.getAllNotes()
    .filter((note) => matchesOwnerFilters(note, args))
    .filter((note) => !args.rootOnly || !index.parentByChild.has(note.noteId))
    .filter((note) => !args.parentNoteId || index.parentByChild.get(note.noteId) === args.parentNoteId)
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs || left.noteId.localeCompare(right.noteId));
  const items = notes.slice(cursor, cursor + limit).map((note) => summarizeNote(note, index));
  const nextCursor = cursor + items.length < notes.length ? cursor + items.length : undefined;
  // note_list historically returned JSON without a prose prefix. Keep that
  // wire shape so existing MCP clients can JSON.parse the complete content.
  return {
    content: [{
      type: "text",
      text: JSON.stringify({ ok: true, message: "Notes listed.", total: notes.length, cursor, nextCursor, items }, null, 2)
    }]
  };
}

export async function handleNoteCreate(
  args: { scope?: "library" | "project" | "session"; title: string; body?: string; parentNoteId?: string; projectPath?: string; provider?: string; sessionId?: string },
  ctx: NoteToolContext
): Promise<NoteMcpResult> {
  const store = ctx.notesStore;
  const heading = `# ${args.title.trim()}`;
  const body = args.body ? `${heading}\n\n${args.body}` : heading;
  let record: NoteRecord;
  if (args.parentNoteId) {
    if (args.scope && args.scope !== "project") throw new Error("parentNoteId can only be used with project scope.");
    if (args.projectPath || args.provider || args.sessionId) throw new Error("Do not provide owner fields when parentNoteId is set.");
    record = await store.createLinkedChildNote(args.parentNoteId, body);
  } else {
    if (!args.scope) throw new Error("scope is required unless parentNoteId is provided.");
    const owner = ownerFromArgs(args as { scope: "library" | "project" | "session"; projectPath?: string; provider?: string; sessionId?: string });
    record = await store.createNote(owner, body);
  }
  const index = await loadRelationshipIndex(ctx);
  return noteResponse("Note created successfully.", { note: summarizeNote(record, index), noteId: record.noteId });
}

export async function handleNoteRead(
  args: { noteId: string; maxLength?: number },
  ctx: NoteToolContext
): Promise<NoteMcpResult> {
  const store = ctx.notesStore;
  const record = await store.getNote(args.noteId);
  if (!record) throw new Error(`Note not found: ${args.noteId}`);
  const content = await store.readNoteContent(args.noteId);
  const doc = parseNoteDocument(content);
  const maxLength = args.maxLength || 5000;
  const truncated = content.length > maxLength;
  const returnedContent = truncated ? `${content.slice(0, maxLength)}\n[...truncated ${content.length - maxLength} chars...]` : content;
  const index = await loadRelationshipIndex(ctx);
  return noteResponse("Note read successfully.", {
    note: summarizeNote(record, index),
    noteId: record.noteId,
    content: returnedContent,
    body: doc.body,
    frontmatter: doc.frontmatter,
    truncated,
    totalLength: content.length
  });
}

export async function handleNoteWrite(
  args: { noteId: string; content: string },
  ctx: NoteToolContext
): Promise<NoteMcpResult> {
  const store = ctx.notesStore;
  const before = await store.getNote(args.noteId);
  if (!before) throw new Error(`Note not found: ${args.noteId}`);
  const existing = await store.readNoteContent(args.noteId);
  const next = parseBodyForWrite(args.content, existing);
  const record = await store.writeNoteContent(args.noteId, buildNoteDocument(next.frontmatter, next.body));
  const index = await loadRelationshipIndex(ctx);
  return noteResponse("Note overwritten successfully.", { note: summarizeNote(record, index), noteId: record.noteId });
}

export async function handleNoteAppend(
  args: { noteId: string; content: string },
  ctx: NoteToolContext
): Promise<NoteMcpResult> {
  const store = ctx.notesStore;
  const before = await store.getNote(args.noteId);
  if (!before) throw new Error(`Note not found: ${args.noteId}`);
  const existing = await store.readNoteContent(args.noteId);
  const doc = parseNoteDocument(existing);
  const body = `${doc.body.trimEnd()}\n\n${args.content.trim()}\n`;
  const record = await store.writeNoteContent(args.noteId, buildNoteDocument(doc.frontmatter, body));
  const index = await loadRelationshipIndex(ctx);
  return noteResponse("Content appended successfully.", { note: summarizeNote(record, index), noteId: record.noteId });
}

export async function handleNoteDelete(
  args: { noteId: string },
  ctx: NoteToolContext
): Promise<NoteMcpResult> {
  const store = ctx.notesStore;
  const before = await store.getNote(args.noteId);
  if (!before) throw new Error(`Note not found: ${args.noteId}`);
  let links: NoteLink[] = [];
  try {
    links = await listAllNoteLinks(ctx.catalogDb || ctx.dbPath);
  } catch {
    // See loadRelationshipIndex: preserve CRUD compatibility for legacy callers.
  }
  const detachedChildNoteIds = links.filter((link) => link.parentNoteId === args.noteId).map((link) => link.childNoteId);
  const index = relationshipIndex(links);
  const note = summarizeNote(before, index);
  await store.deleteNote(args.noteId);
  return noteResponse("Note deleted.", { note, noteId: args.noteId, detachedChildNoteIds });
}

export async function handleNoteTreeRead(
  args: { noteId: string; maxNodes?: number },
  ctx: NoteToolContext
): Promise<NoteMcpResult> {
  const store = ctx.notesStore;
  await store.reload();
  const current = await store.getNote(args.noteId);
  if (!current) throw new Error(`Note not found: ${args.noteId}`);
  const rootNoteId = await store.resolveNoteLinkRoot(args.noteId);
  const subtree = await store.getNoteSubtree(rootNoteId);
  const index = await loadRelationshipIndex(ctx);
  const records = new Map(store.getAllNotes().map((note) => [note.noteId, note]));
  const maxNodes = Math.min(Math.max(args.maxNodes || NOTE_TREE_DEFAULT_MAX_NODES, 1), NOTE_TREE_MAX_NODES);
  let count = 0;
  let truncated = false;
  const mapNode = (node: { noteId: string; title?: string; children: typeof subtree.root.children }): Record<string, unknown> => {
    if (count >= maxNodes) {
      truncated = true;
      return { noteId: node.noteId, truncated: true };
    }
    count += 1;
    const record = records.get(node.noteId);
    const children = node.children.map(mapNode);
    return {
      ...(record ? summarizeNote(record, index) : { noteId: node.noteId, title: node.title }),
      children
    };
  };
  const tree = mapNode(subtree.root);
  return noteResponse("Note tree read successfully.", {
    rootNoteId,
    currentNoteId: args.noteId,
    nodeCount: count,
    maxNodes,
    truncated,
    tree,
    edges: subtree.edges
  });
}

export async function handleNoteSetParent(
  args: { noteId: string; parentNoteId: string | null },
  ctx: NoteToolContext
): Promise<NoteMcpResult> {
  const store = ctx.notesStore;
  const record = await store.getNote(args.noteId);
  if (!record) throw new Error(`Note not found: ${args.noteId}`);
  await store.setNoteParent(args.noteId, args.parentNoteId);
  const index = await loadRelationshipIndex(ctx);
  const updated = await store.getNote(args.noteId);
  return noteResponse(args.parentNoteId ? "Note parent link set." : "Note parent link cleared.", {
    note: updated ? summarizeNote(updated, index) : summarizeNote(record, index),
    noteId: args.noteId,
    parentNoteId: args.parentNoteId
  });
}

export async function handleNoteMove(
  args: { noteId: string; scope: "library" | "project" | "session"; projectPath?: string; provider?: string; sessionId?: string },
  ctx: NoteToolContext
): Promise<NoteMcpResult> {
  const store = ctx.notesStore;
  const before = await store.getNote(args.noteId);
  if (!before) throw new Error(`Note not found: ${args.noteId}`);
  const owner = ownerFromArgs(args);
  const record = await store.moveNote(args.noteId, owner);
  if (args.scope !== "project") {
    try {
      await deleteLinksForNote(ctx.catalogDb || ctx.dbPath, args.noteId);
    } catch {
      // A legacy context may not have a catalog DB path; move itself succeeded.
    }
  }
  await store.reload();
  const updated = await store.getNote(args.noteId);
  const index = await loadRelationshipIndex(ctx);
  return noteResponse("Note moved successfully.", {
    note: updated ? summarizeNote(updated, index) : summarizeNote(record, index),
    noteId: args.noteId,
    detachedFromTree: args.scope !== "project"
  });
}

export async function handleNoteRename(
  args: { noteId: string; filename: string },
  ctx: NoteToolContext
): Promise<NoteMcpResult> {
  const record = await ctx.notesStore.renameNote(args.noteId, args.filename);
  const index = await loadRelationshipIndex(ctx);
  return noteResponse("Note renamed successfully.", { note: summarizeNote(record, index), noteId: record.noteId });
}
