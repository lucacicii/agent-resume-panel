import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { preparePanelDatabasesFromSettings } from "../dbPaths";
import { effectivePanelHome, loadSettings } from "../settings/store";
import { NotesStore } from "../notes/store";
import {
  handleNoteAppend,
  handleNoteCreate,
  handleNoteDelete,
  handleNoteList,
  handleNoteRead,
  handleNoteSearch,
  handleNoteWrite,
  noteAppendSchema,
  noteCreateSchema,
  noteDeleteSchema,
  noteListSchema,
  noteReadSchema,
  noteSearchSchema,
  noteWriteSchema,
  type NoteToolContext
} from "./tools";
import {
  handleNoteGtdCreate,
  handleNoteGtdDelete,
  handleNoteGtdList,
  handleNoteGtdUpdate,
  noteGtdCreateSchema,
  noteGtdDeleteSchema,
  noteGtdListSchema,
  noteGtdUpdateSchema
} from "./gtdTools";
import {
  handleReportList,
  handleReportRead,
  handleReportSearch,
  reportListSchema,
  reportReadSchema,
  reportSearchSchema
} from "./reportTools";
import {
  handleSessionList,
  handleSessionRead,
  handleSessionReadTranscript,
  handleSessionResume,
  handleSessionSearch,
  handleSessionSetGtd,
  sessionListSchema,
  sessionReadSchema,
  sessionReadTranscriptSchema,
  sessionResumeSchema,
  sessionSearchSchema,
  sessionSetGtdSchema
} from "./sessionTools";

export const MCP_SERVER_NAME = "agent-resume-notes";
export const MCP_SERVER_VERSION = "0.2.0";

export interface AgentMcpContext extends NoteToolContext {
  panelHome: string;
  /** Catalog DB path for session tools. Falls back to notesStore when omitted. */
  catalogDb?: string;
  /** Desktop injects resume launcher for session_resume tool. */
  resumeSession?: (args: {
    provider: import("../catalog/types").AgentProvider;
    sessionId: string;
  }) => Promise<{
    ok: boolean;
    command?: string;
    cwd?: string;
    mode?: string;
    external?: boolean;
    error?: string;
  }>;
}

export function createNoteMcpServer(ctx: AgentMcpContext): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    {
      instructions: "Use Agent Resume tools when a user asks to record, save, organize, review, plan, follow up, or update local project/session state, even if they do not name MCP. Search for the target first; never guess a session when multiple matches exist. Do not overwrite, delete, or change a user note unless the user explicitly asks."
    }
  );

  server.registerTool(
    "note_list",
    {
      description:
        "List all indexed notes with optional scope filtering and pagination. Use this instead of note_search when the user asks to enumerate every note.",
      inputSchema: noteListSchema
    },
    async (args: { scope?: string; limit?: number; cursor?: number }) => {
      return handleNoteList(args, ctx);
    }
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

  server.registerTool(
    "note_gtd_list",
    {
      description: "List GTD tasks stored in Markdown notes. Tasks are :::gtd blocks with inbox, next, waiting, someday, reference, or done status. Read-only.",
      inputSchema: noteGtdListSchema
    },
    async (args: { query?: string; status?: string; noteId?: string; limit?: number }) => handleNoteGtdList(args, ctx)
  );

  server.registerTool(
    "note_gtd_create",
    {
      description: "Append one :::gtd task block to an existing note. Provide task text; status defaults to next.",
      inputSchema: noteGtdCreateSchema
    },
    async (args: { noteId: string; text: string; status?: import("../gtd/types").GtdStatus }) => handleNoteGtdCreate(args, ctx)
  );

  server.registerTool(
    "note_gtd_update",
    {
      description: "Update one GTD task in an existing note. Identify it by its current :::gtd block text. If list results show repeated text, pass the occurrence selected by the user.",
      inputSchema: noteGtdUpdateSchema
    },
    async (args: { noteId: string; taskText: string; occurrence?: number; text?: string; status?: import("../gtd/types").GtdStatus }) => handleNoteGtdUpdate(args, ctx)
  );

  server.registerTool(
    "note_gtd_delete",
    {
      description: "Delete one GTD task from an existing note. Identify it by :::gtd block text. If repeated, ask the user to choose an occurrence before deleting.",
      inputSchema: noteGtdDeleteSchema
    },
    async (args: { noteId: string; taskText: string; occurrence?: number }) => handleNoteGtdDelete(args, ctx)
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

  const catalogDb = ctx.catalogDb?.trim() || "";
  const sessionCtx = {
    catalogDb,
    desktopDb: ctx.dbPath,
    panelHome: ctx.panelHome,
    resumeSession: ctx.resumeSession
  };

  server.registerTool(
    "session_search",
    {
      description:
        "Search CLI agent sessions in the local catalog. Matches titles, project paths, and session summaries (keyword). When embeddings are configured, also runs semantic search over summaries and transcript chunks. Use for finding past coding sessions by topic, dialogue detail, project, provider, time, or GTD.",
      inputSchema: sessionSearchSchema
    },
    async (args: {
      query: string;
      provider?: string;
      projectPath?: string;
      gtdStatus?: string;
      fromMs?: number;
      toMs?: number;
      limit?: number;
    }) => {
      if (!sessionCtx.catalogDb) {
        throw new Error("catalogDb is not configured for session tools.");
      }
      return handleSessionSearch(args, sessionCtx);
    }
  );

  server.registerTool(
    "session_list",
    {
      description:
        "List recent catalog sessions with optional filters (provider, project path, GTD, time range). Prefer session_search when the user gives a topic query. Read-only.",
      inputSchema: sessionListSchema
    },
    async (args: {
      provider?: string;
      projectPath?: string;
      gtdStatus?: string;
      fromMs?: number;
      toMs?: number;
      limit?: number;
    }) => {
      if (!sessionCtx.catalogDb) {
        throw new Error("catalogDb is not configured for session tools.");
      }
      return handleSessionList(args, sessionCtx);
    }
  );

  server.registerTool(
    "session_read",
    {
      description:
        "Read catalog metadata and session_summary for one session (provider + sessionId). Prefer this before session_read_transcript. Read-only.",
      inputSchema: sessionReadSchema
    },
    async (args: { provider: string; sessionId: string; maxSummaryLength?: number }) => {
      if (!sessionCtx.catalogDb) {
        throw new Error("catalogDb is not configured for session tools.");
      }
      return handleSessionRead(args, sessionCtx);
    }
  );

  server.registerTool(
    "session_read_transcript",
    {
      description:
        "Load a short recent transcript excerpt for one session (CLI native store or ACP chat thread). Content is sent to the chat model — use only when summary is insufficient. Defaults to 2500 chars (max 8000). Read-only.",
      inputSchema: sessionReadTranscriptSchema
    },
    async (args: { provider: string; sessionId: string; maxChars?: number }) => {
      if (!sessionCtx.catalogDb) {
        throw new Error("catalogDb is not configured for session tools.");
      }
      return handleSessionReadTranscript(args, sessionCtx);
    }
  );

  server.registerTool(
    "session_set_gtd",
    {
      description:
        "Set the GTD status for a catalog session (inbox, next, waiting, someday, reference). Persists to the shared catalog and records an AI audit row when possible. Use when the user asks to mark, triage, or change GTD on a session.",
      inputSchema: sessionSetGtdSchema
    },
    async (args: { provider: string; sessionId: string; status: string; reason?: string }) => {
      if (!sessionCtx.catalogDb) {
        throw new Error("catalogDb is not configured for session tools.");
      }
      return handleSessionSetGtd(args, sessionCtx);
    }
  );

  server.registerTool(
    "session_resume",
    {
      description:
        "Resume a catalog CLI session via the Desktop resume path (terminal / workbench). Use when the user asks to continue or reopen a past coding session. Requires provider + sessionId from session_search/list/read.",
      inputSchema: sessionResumeSchema
    },
    async (args: { provider: string; sessionId: string }) => {
      if (!sessionCtx.catalogDb) {
        throw new Error("catalogDb is not configured for session tools.");
      }
      return handleSessionResume(args, sessionCtx);
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
  return { notesStore, dbPath: paths.desktopDb, panelHome, catalogDb: paths.catalogDb };
}

export async function runStdioServer(panelHomeOverride?: string): Promise<void> {
  const ctx = await createNoteToolContext(panelHomeOverride);
  const server = createNoteMcpServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
