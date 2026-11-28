import * as fs from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type AgentProvider,
  GTD_STATUSES,
  type GtdStatus,
  type NoteRecord,
  absFromRelMdPath,
  ensureExtensionCatalogSchema,
  getCatalogSessionDetail,
  getNoteById,
  getNoteByRelPath,
  getNoteSubtree,
  getParentLink,
  listAllNotes,
  listChildLinks,
  listLibraryNotes,
  listProjectNotes,
  listProjects,
  listSessionNotes,
  listTasks,
  parseNoteDocument,
  queryCatalogSessions,
  queryUnifiedSearch,
  readNoteFile,
  readSessionTranscriptText,
  syncSearchIndex
} from "@agent-resume/core";
import { z } from "zod";
import type { McpResolvedPaths } from "./config.js";

export const MCP_SERVER_NAME = "agent-resume";
export const MCP_SERVER_VERSION = "0.1.0";

const PROVIDER_VALUES = [
  "codex",
  "claude",
  "agy",
  "grok",
  "opencode",
  "pi",
  "prime",
  "omp",
  "cursor",
  "cursor-ide",
  "chat"
] as const satisfies readonly AgentProvider[];

const GTD_FILTER_VALUES = [...GTD_STATUSES, "untagged", "any-tagged"] as const;

function jsonToolResult(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2)
      }
    ]
  };
}

function errorToolResult(message: string) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: message
      }
    ]
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function filterNoteRecords(
  notes: NoteRecord[],
  options: {
    gtdStatus?: GtdStatus | "untagged" | "any-tagged";
    includeArchived?: boolean;
    limit?: number;
  }
): NoteRecord[] {
  let filtered = notes;
  if (!options.includeArchived) {
    filtered = filtered.filter((n) => n.archivedAtMs === undefined);
  }
  if (options.gtdStatus === "untagged") {
    filtered = filtered.filter((n) => !n.gtdStatus);
  } else if (options.gtdStatus === "any-tagged") {
    filtered = filtered.filter((n) => Boolean(n.gtdStatus));
  } else if (options.gtdStatus) {
    filtered = filtered.filter((n) => n.gtdStatus === options.gtdStatus);
  }
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  return filtered.slice(0, limit);
}

export function createAgentResumeMcpServer(paths: McpResolvedPaths): McpServer {
  const server = new McpServer({
    name: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION
  });

  server.registerTool(
    "search_agent_resume",
    {
      title: "Search Notes & Agent Sessions",
      description:
        "Full-text and fuzzy search across Agent Resume Panel coding sessions, ACP chats, and Markdown notes/tasks.",
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe("Search keywords (empty returns most recently updated items)."),
        types: z
          .array(z.enum(["session", "acp", "note"]))
          .optional()
          .describe("Document columns to search. Defaults to all: ['session', 'acp', 'note']."),
        projectPath: z
          .string()
          .optional()
          .describe("Optional project directory path to filter results."),
        gtdStatus: z
          .enum(GTD_FILTER_VALUES)
          .optional()
          .describe("Optional GTD status filter (e.g. inbox, next, waiting, done, untagged)."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Max results per column (default 20)."),
        offset: z.number().int().min(0).optional().describe("Pagination offset per column.")
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ query, types, projectPath, gtdStatus, limit, offset }) => {
      const hasCatalog = await fileExists(paths.catalogDbPath);
      if (!hasCatalog) {
        return jsonToolResult({
          warning: `Catalog database not found at ${paths.catalogDbPath}. Open Agent Resume Panel once or verify panelHome.`,
          sessions: { items: [], total: 0, hasMore: false },
          acp: { items: [], total: 0, hasMore: false },
          notes: { items: [], total: 0, hasMore: false }
        });
      }

      const hasSearchIndex = await fileExists(paths.searchIndexDbPath);
      if (!hasSearchIndex) {
        await ensureExtensionCatalogSchema(paths.catalogDbPath);
        await syncSearchIndex({
          catalogDbPath: paths.catalogDbPath,
          indexDbPath: paths.searchIndexDbPath,
          panelHome: paths.panelHome,
          antigravityHome: paths.antigravityHome,
          opencodeHome: paths.opencodeHome
        });
      }

      const page = { limit: limit ?? 20, offset: offset ?? 0 };
      const result = await queryUnifiedSearch({
        indexDbPath: paths.searchIndexDbPath,
        query: query ?? "",
        columns: types,
        projectScope: projectPath?.trim() ? { projectPath: projectPath.trim() } : undefined,
        gtdFilter: gtdStatus ?? null,
        sessionsPage: page,
        acpPage: page,
        notesPage: page
      });

      return jsonToolResult(result);
    }
  );

  server.registerTool(
    "list_notes",
    {
      title: "List Notes & Tasks",
      description:
        "List Agent Resume Panel Markdown notes or GTD tasks filtered by scope (library/project/session), project path, session, or GTD status.",
      inputSchema: {
        scope: z
          .enum(["all", "library", "project", "session"])
          .optional()
          .describe("Note scope filter (default 'all')."),
        projectPath: z
          .string()
          .optional()
          .describe("Project path (required when scope='project', optional filter otherwise)."),
        provider: z
          .enum(PROVIDER_VALUES)
          .optional()
          .describe("Session provider when querying session-scoped notes."),
        sessionId: z
          .string()
          .optional()
          .describe("Session ID when querying session-scoped notes."),
        gtdStatus: z.enum(GTD_FILTER_VALUES).optional().describe("Optional GTD status filter."),
        tasksOnly: z
          .boolean()
          .optional()
          .describe("When true, return only task notes (frontmatter work: true)."),
        includeArchived: z
          .boolean()
          .optional()
          .describe("Include archived notes (default false)."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Max notes to return (default 50).")
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ scope, projectPath, provider, sessionId, gtdStatus, tasksOnly, includeArchived, limit }) => {
      if (!(await fileExists(paths.catalogDbPath))) {
        return jsonToolResult({ notes: [], total: 0 });
      }
      await ensureExtensionCatalogSchema(paths.catalogDbPath);

      let notes: NoteRecord[];
      if (tasksOnly) {
        notes = await listTasks(paths.catalogDbPath);
        if (scope && scope !== "all") {
          notes = notes.filter((n) => n.scope === scope);
        }
        if (projectPath?.trim()) {
          const target = projectPath.trim();
          notes = notes.filter(
            (n) =>
              n.projectPath === target ||
              n.work?.primaryProject === target ||
              Boolean(n.work?.projects?.includes(target))
          );
        }
      } else if (scope === "library") {
        notes = await listLibraryNotes(paths.catalogDbPath);
      } else if (scope === "project") {
        if (!projectPath?.trim()) {
          return errorToolResult("projectPath is required when scope='project'.");
        }
        notes = await listProjectNotes(paths.catalogDbPath, projectPath.trim());
      } else if (scope === "session") {
        if (!provider || !sessionId?.trim()) {
          return errorToolResult("provider and sessionId are required when scope='session'.");
        }
        notes = await listSessionNotes(paths.catalogDbPath, provider, sessionId.trim());
      } else {
        notes = await listAllNotes(paths.catalogDbPath, 500);
        if (projectPath?.trim()) {
          const target = projectPath.trim();
          notes = notes.filter((n) => n.projectPath === target || n.projectPath?.startsWith(`${target}/`));
        }
        if (provider) {
          notes = notes.filter((n) => n.provider === provider);
        }
        if (sessionId?.trim()) {
          notes = notes.filter((n) => n.agentSessionId === sessionId.trim());
        }
      }

      const filtered = filterNoteRecords(notes, { gtdStatus, includeArchived, limit });
      return jsonToolResult({
        total: filtered.length,
        notes: filtered.map((note) => ({
          ...note,
          absPath: absFromRelMdPath(paths.panelHome, note.relMdPath)
        }))
      });
    }
  );

  server.registerTool(
    "read_note",
    {
      title: "Read Note Content",
      description:
        "Read full Markdown content, parsed frontmatter, and parent/child note links for a note by noteId or relMdPath.",
      inputSchema: {
        noteId: z.string().optional().describe("Note UUID."),
        relMdPath: z
          .string()
          .optional()
          .describe("Relative Markdown path under panelHome (e.g. notes/library/xxx.md).")
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ noteId, relMdPath }) => {
      if (!noteId?.trim() && !relMdPath?.trim()) {
        return errorToolResult("Provide either noteId or relMdPath.");
      }
      if (!(await fileExists(paths.catalogDbPath))) {
        return errorToolResult(`Catalog database not found at ${paths.catalogDbPath}.`);
      }
      await ensureExtensionCatalogSchema(paths.catalogDbPath);

      const note = noteId?.trim()
        ? await getNoteById(paths.catalogDbPath, noteId.trim())
        : await getNoteByRelPath(paths.catalogDbPath, relMdPath!.trim());
      if (!note) {
        return errorToolResult("Note not found.");
      }

      const absPath = absFromRelMdPath(paths.panelHome, note.relMdPath);
      const rawContent = await readNoteFile(absPath);
      const parsed = parseNoteDocument(rawContent);
      const [parentLink, childLinks, subtree] = await Promise.all([
        getParentLink(paths.catalogDbPath, note.noteId),
        listChildLinks(paths.catalogDbPath, note.noteId),
        getNoteSubtree(paths.catalogDbPath, note.noteId)
      ]);

      return jsonToolResult({
        note: {
          ...note,
          absPath
        },
        frontmatter: parsed.frontmatter,
        body: parsed.body,
        rawContent,
        links: {
          parent: parentLink ?? null,
          children: childLinks,
          subtree
        }
      });
    }
  );

  server.registerTool(
    "list_sessions",
    {
      title: "List Agent Sessions",
      description:
        "List indexed coding agent sessions (Codex, Claude Code, Antigravity, Cursor, OpenCode, Grok, Pi, Prime, OMP, ACP Chat) with filtering.",
      inputSchema: {
        provider: z.enum(PROVIDER_VALUES).optional().describe("Filter by agent provider."),
        projectPath: z.string().optional().describe("Filter by project path."),
        gtdStatus: z.enum(GTD_FILTER_VALUES).optional().describe("Filter by session GTD status."),
        search: z
          .string()
          .optional()
          .describe("Substring filter against session title, summary, project path, branch, or ID."),
        includeArchived: z
          .boolean()
          .optional()
          .describe("Include archived sessions (default true)."),
        limit: z.number().int().min(1).max(200).optional().describe("Page size (default 30)."),
        offset: z.number().int().min(0).optional().describe("Pagination offset (default 0).")
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ provider, projectPath, gtdStatus, search, includeArchived, limit, offset }) => {
      if (!(await fileExists(paths.catalogDbPath))) {
        return jsonToolResult({ sessions: [], total: 0, hasMore: false });
      }
      await ensureExtensionCatalogSchema(paths.catalogDbPath);

      const result = await queryCatalogSessions(paths.catalogDbPath, {
        provider,
        projectPath,
        gtdStatus,
        search,
        includeArchived,
        limit,
        offset
      });
      return jsonToolResult(result);
    }
  );

  server.registerTool(
    "get_session",
    {
      title: "Get Session Detail & Transcript",
      description:
        "Fetch metadata, linked notes, and conversation transcript text for a specific session.",
      inputSchema: {
        provider: z.enum(PROVIDER_VALUES).describe("Agent provider (e.g. codex, claude, agy, chat)."),
        sessionId: z.string().min(1).describe("Session ID."),
        includeTranscript: z
          .boolean()
          .optional()
          .describe("Whether to load conversation transcript text (default true)."),
        maxChars: z
          .number()
          .int()
          .min(500)
          .max(512_000)
          .optional()
          .describe("Max transcript characters to return (default 32000).")
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ provider, sessionId, includeTranscript, maxChars }) => {
      if (!(await fileExists(paths.catalogDbPath))) {
        return errorToolResult(`Catalog database not found at ${paths.catalogDbPath}.`);
      }
      await ensureExtensionCatalogSchema(paths.catalogDbPath);

      const detail = await getCatalogSessionDetail(paths.catalogDbPath, provider, sessionId);
      if (!detail) {
        return errorToolResult(`Session not found: ${provider}:${sessionId}`);
      }

      const linkedNotes = await listSessionNotes(paths.catalogDbPath, provider, sessionId);
      const transcript =
        includeTranscript === false
          ? undefined
          : await readSessionTranscriptText({
              panelHome: paths.panelHome,
              antigravityHome: paths.antigravityHome,
              provider,
              sessionId,
              transcriptRefsRaw: detail.transcriptRefsRaw,
              maxChars
            });

      return jsonToolResult({
        session: detail.session,
        transcriptKind: detail.transcriptKind,
        linkedNotes: linkedNotes.map((n) => ({
          ...n,
          absPath: absFromRelMdPath(paths.panelHome, n.relMdPath)
        })),
        transcript
      });
    }
  );

  server.registerTool(
    "list_projects",
    {
      title: "List Indexed Projects",
      description:
        "List logical projects tracked by Agent Resume Panel along with aliases, paths, and session counts.",
      inputSchema: {
        includeHidden: z.boolean().optional().describe("Include hidden projects (default false).")
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ includeHidden }) => {
      if (!(await fileExists(paths.catalogDbPath))) {
        return jsonToolResult({ projects: [] });
      }
      await ensureExtensionCatalogSchema(paths.catalogDbPath);
      const projects = await listProjects(paths.catalogDbPath, {
        includeHidden: includeHidden ?? false
      });
      return jsonToolResult({ total: projects.length, projects });
    }
  );

  return server;
}
