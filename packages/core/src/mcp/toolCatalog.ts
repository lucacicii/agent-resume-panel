/**
 * Static catalog of the MCP tools the desktop Ask agent can call.
 *
 * This is the single source of truth for the Ask chat "tools" popover (renderer
 * lists it via the `agent:listTools` IPC) and is kept in sync with the tool
 * registrations in `server.ts` (see the drift test in packages/core/test).
 */

export type AgentToolCategory =
  | "notes"
  | "reports"
  | "sessions"
  | "projects"
  | "link_graph"
  | "tags";

export interface AgentToolDescriptor {
  name: string;
  /** Short human-readable description (English; used as popover tooltip). */
  description: string;
  category: AgentToolCategory;
}

export const AGENT_TOOL_CATALOG: readonly AgentToolDescriptor[] = [
  // notes
  { name: "note_list", description: "List indexed notes with filters and pagination", category: "notes" },
  { name: "note_search", description: "Search notes by keyword with owner filters", category: "notes" },
  { name: "note_read", description: "Read a note's body and metadata", category: "notes" },
  { name: "note_create", description: "Create a new note", category: "notes" },
  { name: "note_write", description: "Replace a note's Markdown body", category: "notes" },
  { name: "note_append", description: "Append Markdown to a note body", category: "notes" },
  { name: "note_delete", description: "Permanently delete a note", category: "notes" },
  { name: "note_tree_read", description: "Read the linked Project Note tree", category: "notes" },
  { name: "note_set_parent", description: "Set or clear a note parent link", category: "notes" },
  { name: "note_move", description: "Move a note to a different owner scope", category: "notes" },
  { name: "note_rename", description: "Rename a note file", category: "notes" },
  { name: "note_set_gtd", description: "Set or clear a note's GTD status", category: "notes" },

  // reports
  { name: "report_search", description: "Semantic search over memory digests", category: "reports" },
  { name: "report_read", description: "Read a full memory digest by reportId", category: "reports" },
  { name: "report_list", description: "List memory digests by level and period", category: "reports" },

  // sessions
  { name: "session_search", description: "Search CLI agent sessions in the catalog", category: "sessions" },
  { name: "session_list", description: "List recent catalog sessions with filters", category: "sessions" },
  { name: "session_read", description: "Read catalog metadata for one session", category: "sessions" },
  { name: "session_read_transcript", description: "Load a recent transcript excerpt for a session", category: "sessions" },
  { name: "session_set_gtd", description: "Set GTD status for a catalog session", category: "sessions" },
  { name: "session_resume", description: "Resume a catalog session via Desktop", category: "sessions" },
  { name: "session_move", description: "Move a session to a different project directory", category: "sessions" },

  // projects
  { name: "project_list", description: "List catalog projects with session counts", category: "projects" },
  { name: "project_merge", description: "Merge one project into another", category: "projects" },
  { name: "project_tidy", description: "Hide stale or empty projects", category: "projects" },
  { name: "project_reconcile", description: "Reconcile projects from catalog sessions", category: "projects" },

  // link_graph
  { name: "link_graph_trace", description: "Trace a symbol across frontend → API → backend", category: "link_graph" },

  // tags
  { name: "tag_list", description: "List knowledge tags with dimension/status/weight filters", category: "tags" },
  { name: "tag_search", description: "Search knowledge tags by keyword", category: "tags" },
  { name: "tag_entities_list", description: "List sessions and notes bound to a tag", category: "tags" },
  { name: "entity_tags_get", description: "Get all tags on a session or note", category: "tags" },
  { name: "entity_tag_add", description: "Manually add a tag to a session or note", category: "tags" },
  { name: "entity_tag_remove", description: "Remove or soft-obsolete a tag on a session or note", category: "tags" }
];

/** Read-only set of all catalog tool names for quick membership checks. */
export const AGENT_TOOL_NAMES: ReadonlySet<string> = new Set(
  AGENT_TOOL_CATALOG.map((tool) => tool.name)
);
