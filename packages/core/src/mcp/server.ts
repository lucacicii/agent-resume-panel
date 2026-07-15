import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { catalogDbFromSettings, effectivePanelHome } from "../settings/store";
import { loadSettings } from "../settings/store";
import { NotesStore } from "../notes/store";
import {
  handleNoteAppend,
  handleNoteCreate,
  handleNoteDelete,
  handleNoteRead,
  handleNoteSearch,
  handleNoteWrite,
  noteAppendSchema,
  noteCreateSchema,
  noteDeleteSchema,
  noteReadSchema,
  noteSearchSchema,
  noteWriteSchema,
  type NoteToolContext
} from "./tools";

export const MCP_SERVER_NAME = "agent-resume-notes";
export const MCP_SERVER_VERSION = "0.1.0";

export function createNoteMcpServer(ctx: NoteToolContext): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION }
  );

  server.registerTool(
    "note_search",
    {
      description:
        "Search notes by keyword. Matches titles, full content, filenames, note paths, and project paths. Use limit up to 200 for list-all requests; values above 200 are clamped.",
      inputSchema: noteSearchSchema
    },
    async (args: { query: string; scope?: string; limit?: number }) => {
      return handleNoteSearch(args, ctx);
    }
  );

  server.registerTool(
    "note_create",
    {
      description:
        "Create a new note. Choose scope (library, project, or session), provide a title, and optional markdown body. Returns the created note details including noteId.",
      inputSchema: noteCreateSchema
    },
    async (args: {
      scope: "library" | "project" | "session";
      title: string;
      body?: string;
      projectPath?: string;
      provider?: string;
      sessionId?: string;
    }) => {
      return handleNoteCreate(args, ctx);
    }
  );

  server.registerTool(
    "note_read",
    {
      description:
        "Read the full markdown content of a note by noteId. Returns the note metadata and its content.",
      inputSchema: noteReadSchema
    },
    async (args: { noteId: string; maxLength?: number }) => {
      return handleNoteRead(args, ctx);
    }
  );

  server.registerTool(
    "note_write",
    {
      description:
        "Overwrite the entire content of an existing note. The content should include the title heading. Use note_append if you only want to add content.",
      inputSchema: noteWriteSchema
    },
    async (args: { noteId: string; content: string }) => {
      return handleNoteWrite(args, ctx);
    }
  );

  server.registerTool(
    "note_append",
    {
      description:
        "Append markdown content to the end of an existing note. Does not modify existing content.",
      inputSchema: noteAppendSchema
    },
    async (args: { noteId: string; content: string }) => {
      return handleNoteAppend(args, ctx);
    }
  );

  server.registerTool(
    "note_delete",
    {
      description:
        "Permanently delete a note by noteId. This action cannot be undone.",
      inputSchema: noteDeleteSchema
    },
    async (args: { noteId: string }) => {
      return handleNoteDelete(args, ctx);
    }
  );

  return server;
}

export async function createNoteToolContext(panelHomeOverride?: string): Promise<NoteToolContext> {
  const settings = await loadSettings(panelHomeOverride);
  const panelHome = effectivePanelHome(settings, panelHomeOverride);
  const dbPath = catalogDbFromSettings(settings, panelHomeOverride);
  const notesStore = new NotesStore(dbPath, panelHome);
  await notesStore.initialize();
  return { notesStore, dbPath };
}

export async function runStdioServer(panelHomeOverride?: string): Promise<void> {
  const ctx = await createNoteToolContext(panelHomeOverride);
  const server = createNoteMcpServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
