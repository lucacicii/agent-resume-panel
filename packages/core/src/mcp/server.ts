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
  handleProjectList,
  handleProjectMerge,
  handleProjectReconcile,
  handleProjectTidy,
  handleSessionMove,
  projectListSchema,
  projectMergeSchema,
  projectReconcileSchema,
  projectTidySchema,
  sessionMoveSchema
} from "./projectTools";
import { handleLinkGraphTrace, linkGraphTraceSchema } from "./linkGraphTools";
import {
  entityTagAddSchema,
  entityTagRemoveSchema,
  entityTagsGetSchema,
  handleEntityTagAdd,
  handleEntityTagRemove,
  handleEntityTagsGet,
  handleTagEntitiesList,
  handleTagList,
  handleTagSearch,
  tagEntitiesListSchema,
  tagListSchema,
  tagSearchSchema
} from "./tagTools";

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
  /** Expose link_graph_trace. Default true; Ask sets it to the project-scoped state. */
  enableLinkGraphTrace?: boolean;
  /** Default workspaceRoot for link_graph_trace (Ask injects the selected project path). */
  linkGraphWorkspaceRoot?: string;
  /** Abort signal forwarded to the link_graph_trace engine (Ask cancel). */
  linkGraphSignal?: AbortSignal;
  /** Ask returns a condensed chain+summary instead of the full primaryChain/timeline. */
  linkGraphCompact?: boolean;
}

export function createNoteMcpServer(ctx: AgentMcpContext): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    {
      instructions:
        "Use Agent Resume tools when a user asks to record, save, organize, review, plan, follow up, or update local project/session state, even if they do not name MCP. Search for the target first; never guess a session when multiple matches exist. For Notes, preserve noteId and managed frontmatter, use note_tree_read for linked Project Notes, and do not overwrite, delete, move, rename, or change a user note unless the user explicitly asks. For cross-stack field/API/call-chain discovery (前端字段到后端 Controller/VO), call link_graph_trace once with workspaceRoot + symbol (+ filePath/line); the server runs an internal LLM agent that searches and only uses tools for verification."
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

  const projectCtx = { catalogDb, desktopDb: ctx.dbPath };

  server.registerTool(
    "project_list",
    {
      description:
        "List catalog projects with alias, local path, and session counts. Use to review the projects directory before tidying or merging. Read-only.",
      inputSchema: projectListSchema
    },
    async (args: { includeHidden?: boolean; limit?: number }) => {
      if (!projectCtx.catalogDb) {
        throw new Error("catalogDb is not configured for project tools.");
      }
      return handleProjectList(args, projectCtx);
    }
  );

  server.registerTool(
    "project_merge",
    {
      description:
        "Merge a source project into a target project, reassigning its sessions and (by default) the desktop workbench folder tree. Use to consolidate duplicate projects. Removes the source project row.",
      inputSchema: projectMergeSchema
    },
    async (args: { sourceProjectId: string; targetProjectId: string; mergeWorkbenchFolders?: boolean }) => {
      if (!projectCtx.catalogDb) {
        throw new Error("catalogDb is not configured for project tools.");
      }
      return handleProjectMerge(args, projectCtx);
    }
  );

  server.registerTool(
    "project_tidy",
    {
      description:
        "Hide stale/empty projects (not pinned, no visible sessions, local path missing). Dry run by default — pass apply:true to hide. Hidden projects stay recoverable.",
      inputSchema: projectTidySchema
    },
    async (args: { apply?: boolean }) => {
      if (!projectCtx.catalogDb) {
        throw new Error("catalogDb is not configured for project tools.");
      }
      return handleProjectTidy(args, projectCtx);
    }
  );

  server.registerTool(
    "project_reconcile",
    {
      description:
        "Reconcile projects from catalog sessions: merge same-path variants by portable key and re-link sessions to their project. Idempotent and non-destructive.",
      inputSchema: projectReconcileSchema
    },
    async () => {
      if (!projectCtx.catalogDb) {
        throw new Error("catalogDb is not configured for project tools.");
      }
      return handleProjectReconcile({}, projectCtx);
    }
  );

  server.registerTool(
    "session_move",
    {
      description:
        "Move a catalog session to a different project directory. Updates only catalog metadata (project_path/project_id and session-scoped note paths); on-disk session/note files are never moved.",
      inputSchema: sessionMoveSchema
    },
    async (args: { provider: string; sessionId: string; targetProjectPath: string }) => {
      if (!projectCtx.catalogDb) {
        throw new Error("catalogDb is not configured for project tools.");
      }
      return handleSessionMove(args, projectCtx);
    }
  );

  if (ctx.enableLinkGraphTrace !== false) {
    server.registerTool(
      "link_graph_trace",
      {
        description:
          "Trace a code field/symbol across frontend → API client → HTTP path → backend handler → DTO/VO in one call. "
          + "An internal LLM agent performs the full search step-by-step; tools only read/search/verify. "
          + "Use when the user asks for 链路图, call chain, where a form field goes, FE-BE mapping, or API lineage. "
          + "Requires symbol; workspaceRoot defaults to the conversation's project when omitted; pass filePath and line when known. "
          + "Returns a structured primaryChain (or a compact chain when compact is set), summary, and openEnds. "
          + "Requires Agent Resume LLM settings to be configured.",
        inputSchema: linkGraphTraceSchema
      },
      async (args: {
        workspaceRoot?: string;
        symbol: string;
        filePath?: string;
        line?: number;
        selection?: string;
        language?: string;
        backendRoots?: string[];
        timeBudgetMs?: number;
        compact?: boolean;
      }) => {
        return handleLinkGraphTrace(args, {
          defaultWorkspaceRoot: ctx.linkGraphWorkspaceRoot,
          signal: ctx.linkGraphSignal,
          compact: ctx.linkGraphCompact
        });
      }
    );
  }

  const tagCtx = { dbPath: ctx.dbPath };

  server.registerTool(
    "tag_list",
    {
      description:
        "List knowledge tags extracted from sessions and notes. Filter by dimension (tech_stack, business_domain, architecture, task_type, problem_domain, concept_knowledge, context_env), lifecycle status, weight, or entity type. Read-only.",
      inputSchema: tagListSchema
    },
    async (args) => handleTagList(args, tagCtx)
  );

  server.registerTool(
    "tag_search",
    {
      description:
        "Search knowledge tags by keyword against display/normalized names. Use when looking for a theme across sessions and notes. Read-only.",
      inputSchema: tagSearchSchema
    },
    async (args) => handleTagSearch(args, tagCtx)
  );

  server.registerTool(
    "tag_entities_list",
    {
      description:
        "List sessions and notes bound to a given tag, ordered by weight. Use after tag_list/tag_search to drill into entities. Read-only.",
      inputSchema: tagEntitiesListSchema
    },
    async (args) => handleTagEntitiesList(args, tagCtx)
  );

  server.registerTool(
    "entity_tags_get",
    {
      description:
        "Get all tags on one session or note, including weight, hit count, consensus, and status. Read-only.",
      inputSchema: entityTagsGetSchema
    },
    async (args) => handleEntityTagsGet(args, tagCtx)
  );

  server.registerTool(
    "entity_tag_add",
    {
      description:
        "Manually add (or boost) a tag on a session or note. Manual tags do not auto-decay. Use when the user explicitly labels an entity.",
      inputSchema: entityTagAddSchema
    },
    async (args) => handleEntityTagAdd(args, tagCtx)
  );

  server.registerTool(
    "entity_tag_remove",
    {
      description:
        "Remove a tag from a session or note. Default soft-obsoletes (status=obsolete); hardDelete permanently deletes the binding.",
      inputSchema: entityTagRemoveSchema
    },
    async (args) => handleEntityTagRemove(args, tagCtx)
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
