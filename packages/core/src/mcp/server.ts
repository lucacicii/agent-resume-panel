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
  flowNodeCompleteSchema,
  flowReadSchema,
  flowSyncSchema,
  flowValidateSchema,
  handleFlowNodeComplete,
  handleFlowRead,
  handleFlowSync,
  handleFlowValidate
} from "./flowTools";
import { handleLinkGraphTrace, linkGraphTraceSchema } from "./linkGraphTools";

export const MCP_SERVER_NAME = "agent-resume-notes";
export const MCP_SERVER_VERSION = "0.5.0";

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
        "Use Agent Resume tools when a user asks to record, save, organize, review, plan, follow up, or update local project/session state, even if they do not name MCP. Search for the target first; never guess a session when multiple matches exist. For Notes, preserve noteId and managed frontmatter, use note_tree_read for linked Project Notes, and do not overwrite, delete, move, rename, or change a user note unless the user explicitly asks. Flow is the only workflow execution surface. Use flow_sync to create or update sourced workflows and flow_node_complete only for the exact run/node/attempt supplied by an active Flow prompt. For cross-stack field/API/call-chain discovery (前端字段到后端 Controller/VO), call link_graph_trace once with workspaceRoot + symbol (+ filePath/line); the server runs an internal LLM agent that searches and only uses tools for verification."
    }
  );

  server.registerTool(
    "note_list",
    {
      description:
        "List indexed notes with owner filters, root/parent filters, relationship summaries, and pagination. Use this instead of note_search when the user asks to enumerate notes.",
      inputSchema: noteListSchema
    },
    async (args: { scope?: string; projectPath?: string; provider?: string; sessionId?: string; gtdStatus?: string; rootOnly?: boolean; parentNoteId?: string; limit?: number; cursor?: number }) => {
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
    async (args: { query: string; scope?: string; projectPath?: string; provider?: string; sessionId?: string; gtdStatus?: string; limit?: number }) => {
      return runNoteTool(() => handleNoteSearch(args, ctx));
    }
  );

  server.registerTool(
    "note_create",
    {
      description:
        "Create a new note. Choose an owner scope and title, or provide parentNoteId to create a linked Project Note child with the owner inferred from its parent.",
      inputSchema: noteCreateSchema
    },
    async (args: {
      scope?: "library" | "project" | "session";
      title: string;
      body?: string;
      parentNoteId?: string;
      projectPath?: string;
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
      description: "Read the linked Project Note tree containing a note. The root is resolved automatically and output is bounded by maxNodes.",
      inputSchema: noteTreeReadSchema
    },
    async (args: { noteId: string; maxNodes?: number }) => runNoteTool(() => handleNoteTreeRead(args, ctx))
  );

  server.registerTool(
    "note_set_parent",
    {
      description: "Set or clear a Project Note parent link. Cycles and non-Project Notes are rejected.",
      inputSchema: noteSetParentSchema
    },
    async (args: { noteId: string; parentNoteId: string | null }) => runNoteTool(() => handleNoteSetParent(args, ctx))
  );

  server.registerTool(
    "note_move",
    {
      description: "Move a note to a different owner scope. Moving out of project scope detaches the note and its direct children from the association tree.",
      inputSchema: noteMoveSchema
    },
    async (args: { noteId: string; scope: "library" | "project" | "session"; projectPath?: string; provider?: string; sessionId?: string }) => runNoteTool(() => handleNoteMove(args, ctx))
  );

  server.registerTool(
    "note_rename",
    {
      description: "Rename a note file while preserving and rewriting its asset directory and relative asset references.",
      inputSchema: noteRenameSchema
    },
    async (args: { noteId: string; filename: string }) => runNoteTool(() => handleNoteRename(args, ctx))
  );

  server.registerTool(
    "flow_sync",
    {
      description: "Idempotently create or update a sourced Flow definition. The root and every node Note must belong to the same Project Note subtree.",
      inputSchema: flowSyncSchema
    },
    async (args: import("../flow/types").FlowSyncInput) => runNoteTool(() => handleFlowSync(args, ctx))
  );

  server.registerTool(
    "flow_read",
    {
      description: "Read a Flow by flowId or stable sourceKind/sourceKey, optionally including its latest run.",
      inputSchema: flowReadSchema
    },
    async (args: { flowId?: string; sourceKind?: string; sourceKey?: string; includeRun?: boolean }) => runNoteTool(() => handleFlowRead(args, ctx))
  );

  server.registerTool(
    "flow_validate",
    {
      description: "Validate a Flow DAG and verify that every node Note belongs to the root Project Note subtree.",
      inputSchema: flowValidateSchema
    },
    async (args: { flowId?: string; sourceKind?: string; sourceKey?: string }) => runNoteTool(() => handleFlowValidate(args, ctx))
  );

  server.registerTool(
    "flow_node_complete",
    {
      description: "Complete the exact running Flow node attempt, write its result to the node/root Note status regions, and make the next dependency-ready node available.",
      inputSchema: flowNodeCompleteSchema
    },
    async (args: import("../flow/types").FlowCompletionInput) => runNoteTool(() => handleFlowNodeComplete(args, ctx))
  );

  server.registerTool(
    "note_set_gtd",
    {
      description: "Set or clear the catalog GTD status for one Markdown note. This changes catalog metadata and does not modify note content.",
      inputSchema: noteSetGtdSchema
    },
    async (args: { noteId: string; status: import("../gtd/types").GtdStatus | null }) => runNoteTool(() => handleNoteSetGtd(args, ctx))
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

  server.registerTool(
    "link_graph_trace",
    {
      description:
        "Trace a code field/symbol across frontend → API client → HTTP path → backend handler → DTO/VO in one call. "
        + "An internal LLM agent performs the full search step-by-step; tools only read/search/verify. "
        + "Use when the user asks for 链路图, call chain, where a form field goes, FE-BE mapping, or API lineage. "
        + "Requires workspaceRoot + symbol; pass filePath and line when known. Returns structured primaryChain, timeline, summary, openEnds. "
        + "Requires Agent Resume LLM settings to be configured.",
      inputSchema: linkGraphTraceSchema
    },
    async (args: {
      workspaceRoot: string;
      symbol: string;
      filePath?: string;
      line?: number;
      selection?: string;
      language?: string;
      backendRoots?: string[];
      timeBudgetMs?: number;
    }) => {
      return handleLinkGraphTrace(args);
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
