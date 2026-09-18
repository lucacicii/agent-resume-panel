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
  handleNoteMove,
  handleNoteRename,
  handleNoteRead,
  handleNoteSearch,
  handleNoteSetGtd,
  handleNoteSetParent,
  handleNoteTreeRead,
  handleNoteWrite,
  noteAppendSchema,
  noteCreateSchema,
  noteDeleteSchema,
  noteListSchema,
  noteMoveSchema,
  noteRenameSchema,
  noteReadSchema,
  noteSearchSchema,
  noteSetGtdSchema,
  noteSetParentSchema,
  noteTreeReadSchema,
  noteWriteSchema,
  runNoteTool,
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
import {
  handleMemoryRetrieve,
  memoryRetrieveSchema
} from "./memoryTools";
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
import {
  handleTaskCreate,
  handleTaskLinkSession,
  handleTaskList,
  handleTaskRead,
  handleTaskUnlinkSession,
  handleTaskWrite,
  taskCreateSchema,
  taskLinkSessionSchema,
  taskListSchema,
  taskReadSchema,
  taskUnlinkSessionSchema,
  taskWriteSchema
} from "./taskTools";
import {
  handleWorkbenchList,
  handleWorkbenchRead,
  workbenchListSchema,
  workbenchReadSchema
} from "./workbenchTools";
import { mcpSessionContextFromEnv } from "./sessionContext";

export const MCP_SERVER_NAME = "agent-resume-notes";
export const MCP_SERVER_VERSION = "0.6.0";

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
      instructions:
        "Use Agent Resume tools when a user asks to record, save, organize, review, plan, follow up, or update local project/session state, even if they do not name MCP. Search for the target first; never guess a session when multiple matches exist. For Notes, preserve noteId and managed frontmatter, use note_tree_read for task (task) knowledge trees, and do not overwrite, delete, move, rename, or change a user note unless the user explicitly asks. Project notes belong to the VS Code extension and are not exposed here."
    }
  );

  server.registerTool(
    "note_list",
    {
      description:
        "List indexed notes with owner filters, root/parent filters, relationship summaries, and pagination. Use this instead of note_search when the user asks to enumerate notes.",
      inputSchema: noteListSchema
    },
    async (args: { scope?: string; rootPath?: string; provider?: string; sessionId?: string; gtdStatus?: string; rootOnly?: boolean; parentNoteId?: string; limit?: number; cursor?: number }) => {
      return runNoteTool(() => handleNoteList(args, ctx));
    }
  );

  server.registerTool(
    "note_search",
    {
      description:
        "Search notes by keyword across metadata, indexed content, paths, and session identity. Supports owner filters and returns relationship-aware summaries.",
      inputSchema: noteSearchSchema
    },
    async (args: { query: string; scope?: string; rootPath?: string; provider?: string; sessionId?: string; gtdStatus?: string; limit?: number }) => {
      return runNoteTool(() => handleNoteSearch(args, ctx));
    }
  );

  server.registerTool(
    "note_create",
    {
      description:
        "Create a new note. Pass parentNoteId to put it under a task, or scope to choose an owner explicitly; when neither is given the owner is resolved from the current session — its bound task (task) first, then the session itself, then no owner. Project notes are extension-only.",
      inputSchema: noteCreateSchema
    },
    async (args: {
      scope?: "library" | "session";
      title: string;
      body?: string;
      parentNoteId?: string;
      provider?: string;
      sessionId?: string;
    }) => {
      return runNoteTool(() => handleNoteCreate(args, ctx));
    }
  );

  server.registerTool(
    "note_read",
    {
      description:
        "Read a note by noteId. Returns relationship-aware metadata, managed frontmatter, Markdown body, raw content, and truncation information.",
      inputSchema: noteReadSchema
    },
    async (args: { noteId: string; maxLength?: number }) => {
      return runNoteTool(() => handleNoteRead(args, ctx));
    }
  );

  server.registerTool(
    "note_write",
    {
      description:
        "Replace a note's Markdown body or complete document while preserving catalog-owned frontmatter and note identity.",
      inputSchema: noteWriteSchema
    },
    async (args: { noteId: string; content: string }) => {
      return runNoteTool(() => handleNoteWrite(args, ctx));
    }
  );

  server.registerTool(
    "note_append",
    {
      description:
        "Append Markdown to a note body while preserving catalog-owned frontmatter and existing content.",
      inputSchema: noteAppendSchema
    },
    async (args: { noteId: string; content: string }) => {
      return runNoteTool(() => handleNoteAppend(args, ctx));
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
      return runNoteTool(() => handleNoteDelete(args, ctx));
    }
  );

  server.registerTool(
    "note_tree_read",
    {
      description: "Read the linked note tree containing a note (a task / task knowledge tree). The root is resolved automatically and output is bounded by maxNodes.",
      inputSchema: noteTreeReadSchema
    },
    async (args: { noteId: string; maxNodes?: number }) => runNoteTool(() => handleNoteTreeRead(args, ctx))
  );

  server.registerTool(
    "note_set_parent",
    {
      description: "Set or clear a note parent link. Cycles are rejected; only a task (task) can be a parent, and session notes cannot participate.",
      inputSchema: noteSetParentSchema
    },
    async (args: { noteId: string; parentNoteId: string | null }) => runNoteTool(() => handleNoteSetParent(args, ctx))
  );

  server.registerTool(
    "note_move",
    {
      description: "Move a note to a different owner scope (library or session). Moving detaches the note and its direct children from any task association tree.",
      inputSchema: noteMoveSchema
    },
    async (args: { noteId: string; scope: "library" | "session"; provider?: string; sessionId?: string }) => runNoteTool(() => handleNoteMove(args, ctx))
  );

  server.registerTool(
    "note_rename",
    {
      description: "Rename a note. For tasks this renames the task itself; otherwise it renames the file while preserving and rewriting its asset directory and relative asset references.",
      inputSchema: noteRenameSchema
    },
    async (args: { noteId: string; filename: string }) => runNoteTool(() => handleNoteRename(args, ctx))
  );

  server.registerTool(
    "note_set_gtd",
    {
      description: "Set or clear the catalog GTD status for one Markdown note. This changes catalog metadata and does not modify note content.",
      inputSchema: noteSetGtdSchema
    },
    async (args: { noteId: string; status: import("../gtd/types").GtdStatus | null }) => runNoteTool(() => handleNoteSetGtd(args, ctx))
  );

  const reportCtx = { dbPath: ctx.dbPath, panelHome: ctx.panelHome, catalogDb: ctx.catalogDb };

  server.registerTool(
    "memory_retrieve",
    {
      description:
        "Retrieve relevant context across all local memory: memory digests (daily/weekly/monthly reports), project notes, and historical agent sessions in one shot with citation markers [D#], [N#], [S#].",
      inputSchema: memoryRetrieveSchema
    },
    async (args: { query: string; rootPath?: string; limit?: number }) => {
      return handleMemoryRetrieve(reportCtx, args);
    }
  );

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
        "Search CLI agent sessions in the local catalog. Matches titles, root paths, and session summaries (keyword). When embeddings are configured, also runs semantic search over summaries and transcript chunks. Use for finding past coding sessions by topic, dialogue detail, root, provider, time, or GTD.",
      inputSchema: sessionSearchSchema
    },
    async (args: {
      query: string;
      provider?: string;
      rootPath?: string;
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
        "List recent catalog sessions with optional filters (provider, root path, GTD, time range). Prefer session_search when the user gives a topic query. Read-only.",
      inputSchema: sessionListSchema
    },
    async (args: {
      provider?: string;
      rootPath?: string;
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

  const taskCtx = { notesStore: ctx.notesStore, dbPath: ctx.dbPath, catalogDb };

  server.registerTool(
    "task_list",
    {
      description:
        "List tasks (tasks) with GTD status, next action, owed decision, referenced project roots (multi-root), and linked-session counts. Prefer this over note_list when the user asks about tasks, tasks, or project follow-ups.",
      inputSchema: taskListSchema
    },
    async (args: { gtdStatus?: import("../gtd/types").GtdStatus; rootPath?: string; limit?: number }) => {
      return handleTaskList(args, taskCtx);
    }
  );

  server.registerTool(
    "task_read",
    {
      description:
        "Read one task: front-matter work fields (next action, decision, multi-root project references), linked sessions with their project paths, and its workbenches. Read-only.",
      inputSchema: taskReadSchema
    },
    async (args: { noteId: string; maxContentLength?: number }) => {
      return handleTaskRead(args, taskCtx);
    }
  );

  server.registerTool(
    "task_create",
    {
      description:
        "Create a task (task). Tasks are library-scoped and reference 0..n repository roots instead of belonging to one. Use when the user asks to record, plan, or open a new piece of work.",
      inputSchema: taskCreateSchema
    },
    async (args: {
      title: string;
      next?: string;
      decision?: string;
      roots?: string[];
      primaryRoot?: string;
      sessions?: string[];
      gtdStatus?: import("../gtd/types").GtdStatus;
    }) => {
      return handleTaskCreate(args, taskCtx);
    }
  );

  server.registerTool(
    "task_write",
    {
      description:
        "Update a task's next action, owed decision, multi-root references, primary root, or GTD status. Only the fields you pass are changed.",
      inputSchema: taskWriteSchema
    },
    async (args: {
      noteId: string;
      next?: string | null;
      decision?: string | null;
      roots?: string[];
      primaryRoot?: string | null;
      gtdStatus?: import("../gtd/types").GtdStatus | null;
    }) => {
      return handleTaskWrite(args, taskCtx);
    }
  );

  server.registerTool(
    "task_link_session",
    {
      description:
        "Link a catalog session to a task (task). When rootPath is given, also reference that root and, by default, rebind the session's catalog project path — this replaces the removed session_move tool.",
      inputSchema: taskLinkSessionSchema
    },
    async (args: {
      noteId: string;
      provider: string;
      sessionId: string;
      rootPath?: string;
      rebindRoot?: boolean;
    }) => {
      return handleTaskLinkSession(args, taskCtx);
    }
  );

  server.registerTool(
    "task_unlink_session",
    {
      description:
        "Unlink a catalog session from a task. The session itself and its catalog metadata are left untouched.",
      inputSchema: taskUnlinkSessionSchema
    },
    async (args: { noteId: string; provider: string; sessionId: string }) => {
      return handleTaskUnlinkSession(args, taskCtx);
    }
  );

  const workbenchCtx = { desktopDb: ctx.dbPath };

  server.registerTool(
    "workbench_list",
    {
      description:
        "List a task's workbenches with their project binding and linked-session counts. Workbenches are desktop-only units of work; read-only and unavailable when Desktop's tables are absent.",
      inputSchema: workbenchListSchema
    },
    async (args: { taskNoteId: string }) => {
      return handleWorkbenchList(args, workbenchCtx);
    }
  );

  server.registerTool(
    "workbench_read",
    {
      description:
        "Read one workbench: its task, bound project root (null = the task's neutral workspace), pane layout, and linked sessions. Read-only.",
      inputSchema: workbenchReadSchema
    },
    async (args: { workbenchId: string }) => {
      return handleWorkbenchRead(args, workbenchCtx);
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
  return {
    notesStore,
    dbPath: paths.desktopDb,
    panelHome,
    catalogDb: paths.catalogDb,
    sessionContext: mcpSessionContextFromEnv()
  };
}

export async function runStdioServer(panelHomeOverride?: string): Promise<void> {
  const ctx = await createNoteToolContext(panelHomeOverride);
  const server = createNoteMcpServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
