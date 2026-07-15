import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { preparePanelDatabasesFromSettings } from "../dbPaths";
import { effectivePanelHome, loadSettings } from "../settings/store";
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
import {
  handleReportList,
  handleReportRead,
  handleReportSearch,
  reportListSchema,
  reportReadSchema,
  reportSearchSchema
} from "./reportTools";

export const MCP_SERVER_NAME = "agent-resume-notes";
export const MCP_SERVER_VERSION = "0.1.0";

export interface AgentMcpContext extends NoteToolContext {
  panelHome: string;
}

export function createNoteMcpServer(ctx: AgentMcpContext): McpServer {
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

  const reportCtx = { dbPath: ctx.dbPath, panelHome: ctx.panelHome };

  server.registerTool(
    "report_search",
    {
      description:
        "Semantic search over memory digests (daily/weekly/monthly reports). Use when Report Sources in the prompt are insufficient or the user asks for a different query. If a reportId is already cited, prefer report_read instead of searching again.",
      inputSchema: reportSearchSchema
    },
    async (args: { query: string; level?: "daily" | "weekly" | "monthly"; limit?: number }) => {
      return handleReportSearch(args, reportCtx);
    }
  );

  server.registerTool(
    "report_read",
    {
      description:
        "Read a full memory digest by reportId (e.g. daily:2026-07-15). Use to expand truncated Report Sources from the prompt. Read-only.",
      inputSchema: reportReadSchema
    },
    async (args: { reportId: string; maxLength?: number }) => {
      return handleReportRead(args, reportCtx);
    }
  );

  server.registerTool(
    "report_list",
    {
      description:
        "List memory digests by level, optionally within a period range. Use for questions like which weekly reports exist in a date span. Read-only.",
      inputSchema: reportListSchema
    },
    async (args: {
      level: "daily" | "weekly" | "monthly";
      from?: string;
      to?: string;
      limit?: number;
    }) => {
      return handleReportList(args, reportCtx);
    }
  );

  return server;
}

export async function createNoteToolContext(panelHomeOverride?: string): Promise<AgentMcpContext> {
  const settings = await loadSettings(panelHomeOverride);
  const panelHome = effectivePanelHome(settings, panelHomeOverride);
  const paths = await preparePanelDatabasesFromSettings(panelHomeOverride);
  const notesStore = new NotesStore(paths.catalogDb, panelHome);
  await notesStore.initialize();
  return { notesStore, dbPath: paths.desktopDb, panelHome };
}

export async function runStdioServer(panelHomeOverride?: string): Promise<void> {
  const ctx = await createNoteToolContext(panelHomeOverride);
  const server = createNoteMcpServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
