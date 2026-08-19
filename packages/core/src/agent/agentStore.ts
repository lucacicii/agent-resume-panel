import { randomUUID } from "node:crypto";
import { ensureDesktopDbSchema } from "../catalog/db";
import { createUiText } from "../i18n/uiText";
import { loadSettings } from "../settings/store";
import { escapeSqlLiteral, runSqlite, runSqliteJson, runSqliteTransaction } from "../sqlite";
import { AgentCitation, AgentToolTraceStep } from "./types";

export interface AgentChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: AgentCitation[];
  fallback?: boolean;
  toolTrace?: AgentToolTraceStep[];
  createdAtMs: number;
  sortOrder: number;
}

interface AskMessageRow {
  id: string;
  role: string;
  content: string;
  citations_json: string | null;
  tool_trace_json: string | null;
  fallback: number;
  sort_order: number;
  created_at_ms: number;
}

function parseCitationsJson(raw: string | null | undefined): AgentCitation[] | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as AgentCitation[]) : undefined;
  } catch {
    return undefined;
  }
}

function parseToolTraceJson(raw: string | null | undefined): AgentToolTraceStep[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed as AgentToolTraceStep[] : undefined;
  } catch {
    return undefined;
  }
}

function rowToMessage(row: AskMessageRow): AgentChatMessage | undefined {
  if (row.role !== "user" && row.role !== "assistant") {
    return undefined;
  }
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    citations: parseCitationsJson(row.citations_json),
    toolTrace: parseToolTraceJson(row.tool_trace_json),
    fallback: row.fallback ? true : undefined,
    createdAtMs: row.created_at_ms,
    sortOrder: row.sort_order
  };
}

export interface AgentChatListResult {
  messages: AgentChatMessage[];
  hasMore: boolean;
}

const DEFAULT_ASK_CHAT_PAGE = 40;
const MAX_ASK_CHAT_PAGE = 100;

function normalizeAskPageLimit(limit?: number): number {
  return Math.max(1, Math.min(limit ?? DEFAULT_ASK_CHAT_PAGE, MAX_ASK_CHAT_PAGE));
}

async function listAgentMessagesDescending(
  dbPath: string,
  sqlWhere: string,
  limit: number
): Promise<AgentChatListResult> {
  await ensureDesktopDbSchema(dbPath);
  const page = normalizeAskPageLimit(limit);
  const rows = await runSqliteJson<AskMessageRow>(
    dbPath,
    `SELECT id, role, content, citations_json, tool_trace_json, fallback, sort_order, created_at_ms
     FROM agent_messages
     ${sqlWhere}
     ORDER BY sort_order DESC, created_at_ms DESC
     LIMIT ${page + 1};`
  );
  const hasMore = rows.length > page;
  const slice = hasMore ? rows.slice(0, page) : rows;
  const messages = slice
    .reverse()
    .map(rowToMessage)
    .filter((m): m is AgentChatMessage => Boolean(m));
  return { messages, hasMore };
}

async function nextSortOrderBase(dbPath: string): Promise<number> {
  const rows = await runSqliteJson<{ max_order: number }>(
    dbPath,
    "SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM agent_messages;"
  );
  return rows[0]?.max_order ?? 0;
}

export interface AgentThread {
  id: string;
  title: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export async function ensureDefaultThread(dbPath: string): Promise<string> {
  await ensureDesktopDbSchema(dbPath);
  const threads = await runSqliteJson<{ id: string }>(
    dbPath,
    "SELECT id FROM agent_threads LIMIT 1;"
  );
  let activeThreadId = "default-thread";
  if (threads.length === 0) {
    const now = Date.now();
    // Try to get title from first user message
    const firstMsg = await runSqliteJson<{ content: string }>(
      dbPath,
      "SELECT content FROM agent_messages WHERE role = 'user' ORDER BY sort_order ASC LIMIT 1;"
    );
    const settings = await loadSettings();
    const pt = createUiText(settings);
    const title = firstMsg[0]?.content?.slice(0, 30) || pt("desktop.agent.newThread");
    await runSqlite(
      dbPath,
      `INSERT INTO agent_threads (id, title, created_at_ms, updated_at_ms)
       VALUES ('default-thread', '${escapeSqlLiteral(title)}', ${now}, ${now});`
    );
  } else {
    activeThreadId = threads[0].id;
  }
  // Migrate any orphaned messages
  await runSqlite(
    dbPath,
    `UPDATE agent_messages SET thread_id = '${escapeSqlLiteral(activeThreadId)}' WHERE thread_id IS NULL;`
  );
  return activeThreadId;
}

export async function listAgentThreads(dbPath: string): Promise<AgentThread[]> {
  await ensureDefaultThread(dbPath);
  const rows = await runSqliteJson<{ id: string; title: string; created_at_ms: number; updated_at_ms: number }>(
    dbPath,
    "SELECT id, title, created_at_ms, updated_at_ms FROM agent_threads ORDER BY updated_at_ms DESC;"
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    createdAtMs: r.created_at_ms,
    updatedAtMs: r.updated_at_ms
  }));
}

export async function createAgentThread(dbPath: string, args: { id?: string; title: string }): Promise<AgentThread> {
  await ensureDesktopDbSchema(dbPath);
  const id = args.id || randomUUID();
  const title = args.title;
  const now = Date.now();
  await runSqlite(
    dbPath,
    `INSERT INTO agent_threads (id, title, created_at_ms, updated_at_ms)
     VALUES ('${escapeSqlLiteral(id)}', '${escapeSqlLiteral(title)}', ${now}, ${now});`
  );
  return { id, title, createdAtMs: now, updatedAtMs: now };
}

export async function renameAgentThread(dbPath: string, id: string, title: string): Promise<void> {
  await ensureDesktopDbSchema(dbPath);
  const now = Date.now();
  await runSqlite(
    dbPath,
    `UPDATE agent_threads SET title = '${escapeSqlLiteral(title)}', updated_at_ms = ${now} WHERE id = '${escapeSqlLiteral(id)}';`
  );
}

export async function deleteAgentThread(dbPath: string, id: string): Promise<void> {
  await ensureDesktopDbSchema(dbPath);
  await runSqliteTransaction(dbPath, [
    `DELETE FROM agent_messages WHERE thread_id = '${escapeSqlLiteral(id)}';`,
    `DELETE FROM agent_threads WHERE id = '${escapeSqlLiteral(id)}';`
  ]);
}

/** Latest messages for Ask UI (most recent first in query, returned chronological). */
export async function listRecentAgentMessages(
  dbPath: string,
  options?: { limit?: number; threadId?: string }
): Promise<AgentChatListResult> {
  let where = "";
  if (options?.threadId) {
    where = `WHERE thread_id = '${escapeSqlLiteral(options.threadId)}'`;
  } else {
    const defaultId = await ensureDefaultThread(dbPath);
    where = `WHERE thread_id = '${escapeSqlLiteral(defaultId)}'`;
  }
  return listAgentMessagesDescending(dbPath, where, normalizeAskPageLimit(options?.limit));
}

/** Older messages before a sort_order cursor (for scroll-up pagination). */
export async function listOlderAgentMessages(
  dbPath: string,
  options: { beforeSortOrder: number; limit?: number; threadId?: string }
): Promise<AgentChatListResult> {
  const before = Math.max(0, Math.floor(options.beforeSortOrder));
  let threadId = options.threadId;
  if (!threadId) {
    threadId = await ensureDefaultThread(dbPath);
  }
  return listAgentMessagesDescending(
    dbPath,
    `WHERE sort_order < ${before} AND thread_id = '${escapeSqlLiteral(threadId)}'`,
    normalizeAskPageLimit(options.limit)
  );
}

/** @deprecated Use listRecentAgentMessages */
export async function listAgentMessages(
  dbPath: string,
  options?: { limit?: number; threadId?: string }
): Promise<AgentChatMessage[]> {
  const result = await listRecentAgentMessages(dbPath, options);
  return result.messages;
}

/** Last N user/assistant turns for Meta-Agent prompt context. */
export async function listAgentMessagesForHistory(
  dbPath: string,
  maxTurns = 6,
  threadId?: string
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  const { messages } = await listRecentAgentMessages(dbPath, { limit: maxTurns * 2, threadId });
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

export async function appendAgentTurn(
  dbPath: string,
  turn: {
    userContent: string;
    assistantContent: string;
    citations?: AgentCitation[];
    fallback?: boolean;
    toolTrace?: AgentToolTraceStep[];
    threadId?: string;
  }
): Promise<void> {
  await ensureDesktopDbSchema(dbPath);
  let threadId = turn.threadId;
  if (!threadId) {
    threadId = await ensureDefaultThread(dbPath);
  }
  const base = await nextSortOrderBase(dbPath);
  const userId = randomUUID();
  const assistantId = randomUUID();
  const now = Date.now();
  const citationsJson = turn.citations?.length ? JSON.stringify(turn.citations) : null;
  const toolTraceJson = turn.toolTrace?.length ? JSON.stringify(turn.toolTrace) : null;
  const fallback = turn.fallback ? 1 : 0;

  await runSqliteTransaction(dbPath, [
    `INSERT INTO agent_messages (id, role, content, citations_json, tool_trace_json, fallback, sort_order, created_at_ms, thread_id)
     VALUES (
       '${escapeSqlLiteral(userId)}',
       'user',
       '${escapeSqlLiteral(turn.userContent)}',
       NULL,
       NULL,
       0,
       ${base + 1},
       ${now},
       '${escapeSqlLiteral(threadId)}'
     )`,
    `INSERT INTO agent_messages (id, role, content, citations_json, tool_trace_json, fallback, sort_order, created_at_ms, thread_id)
     VALUES (
       '${escapeSqlLiteral(assistantId)}',
       'assistant',
       '${escapeSqlLiteral(turn.assistantContent)}',
       ${citationsJson ? `'${escapeSqlLiteral(citationsJson)}'` : "NULL"},
       ${toolTraceJson ? `'${escapeSqlLiteral(toolTraceJson)}'` : "NULL"},
       ${fallback},
       ${base + 2},
       ${now + 1},
       '${escapeSqlLiteral(threadId)}'
     )`,
    `UPDATE agent_threads SET updated_at_ms = ${now + 1} WHERE id = '${escapeSqlLiteral(threadId)}';`
  ]);
}

export async function clearAgentMessages(dbPath: string, threadId?: string): Promise<void> {
  await ensureDesktopDbSchema(dbPath);
  if (threadId) {
    await runSqlite(dbPath, `DELETE FROM agent_messages WHERE thread_id = '${escapeSqlLiteral(threadId)}';`);
  } else {
    await runSqlite(dbPath, "DELETE FROM agent_messages;");
  }
}

/** Delete a message and all later messages in the thread (by sort_order, inclusive). */
export async function deleteAgentMessagesFromSortOrder(
  dbPath: string,
  options: { threadId: string; fromSortOrder: number }
): Promise<void> {
  await ensureDesktopDbSchema(dbPath);
  const threadId = options.threadId?.trim();
  if (!threadId) {
    throw new Error("threadId is required.");
  }
  const fromSortOrder = Math.max(0, Math.floor(options.fromSortOrder));
  const now = Date.now();
  await runSqliteTransaction(dbPath, [
    `DELETE FROM agent_messages
     WHERE thread_id = '${escapeSqlLiteral(threadId)}'
       AND sort_order >= ${fromSortOrder};`,
    `UPDATE agent_threads SET updated_at_ms = ${now} WHERE id = '${escapeSqlLiteral(threadId)}';`
  ]);
}
