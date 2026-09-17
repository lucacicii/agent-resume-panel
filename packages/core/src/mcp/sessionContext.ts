/**
 * MCP session context.
 *
 * The core data MCP is a stdio server, so it cannot see which Desktop session
 * (or task) invoked it. Desktop injects the identity as environment
 * variables when it launches the agent:
 *
 * - `AGENT_RESUME_WORK_ITEM_ID` — set when the session was started for a work
 *   item, so note operations default to that task's knowledge tree.
 * - `AGENT_RESUME_PROVIDER` / `AGENT_RESUME_SESSION_ID` — the catalog session
 *   key, set on resume (and on ACP sessions), so note operations can resolve the
 *   task the session is linked to, or fall back to the session itself.
 *
 * Any of them may be absent (a CLI the user started on their own): notes then
 * default to no owner at all.
 */
export interface McpSessionContext {
  provider?: string;
  sessionId?: string;
  taskNoteId?: string;
}

export const MCP_SESSION_ENV = {
  taskNoteId: "AGENT_RESUME_WORK_ITEM_ID",
  provider: "AGENT_RESUME_PROVIDER",
  sessionId: "AGENT_RESUME_SESSION_ID"
} as const;

/** Every env var the MCP session context reads, for allowlist-style merging. */
export const MCP_SESSION_ENV_KEYS: readonly string[] = Object.values(MCP_SESSION_ENV);

function readEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function mcpSessionContextFromEnv(env: NodeJS.ProcessEnv = process.env): McpSessionContext {
  return {
    provider: readEnv(env, MCP_SESSION_ENV.provider),
    sessionId: readEnv(env, MCP_SESSION_ENV.sessionId),
    taskNoteId: readEnv(env, MCP_SESSION_ENV.taskNoteId)
  };
}

/** True when the context carries no usable identity. */
export function isEmptyMcpSessionContext(context: McpSessionContext | undefined): boolean {
  return !context?.taskNoteId && !(context?.provider && context?.sessionId);
}
