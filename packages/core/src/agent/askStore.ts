import { randomUUID } from "node:crypto";
import { ensureCatalogSchema } from "../catalog/db";
import { escapeSqlLiteral, runSqlite, runSqliteJson, runSqliteTransaction } from "../sqlite";
import { AgentCitation } from "./types";

export interface AskChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: AgentCitation[];
  fallback?: boolean;
  createdAtMs: number;
  sortOrder: number;
}

interface AskMessageRow {
  id: string;
  role: string;
  content: string;
  citations_json: string | null;
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

function rowToMessage(row: AskMessageRow): AskChatMessage | undefined {
  if (row.role !== "user" && row.role !== "assistant") {
    return undefined;
  }
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    citations: parseCitationsJson(row.citations_json),
    fallback: row.fallback ? true : undefined,
    createdAtMs: row.created_at_ms,
    sortOrder: row.sort_order
  };
}

export interface AskChatListResult {
  messages: AskChatMessage[];
  hasMore: boolean;
}

const DEFAULT_ASK_CHAT_PAGE = 40;
const MAX_ASK_CHAT_PAGE = 100;

function normalizeAskPageLimit(limit?: number): number {
  return Math.max(1, Math.min(limit ?? DEFAULT_ASK_CHAT_PAGE, MAX_ASK_CHAT_PAGE));
}

async function listAskMessagesDescending(
  dbPath: string,
  sqlWhere: string,
  limit: number
): Promise<AskChatListResult> {
  await ensureCatalogSchema(dbPath);
  const page = normalizeAskPageLimit(limit);
  const rows = await runSqliteJson<AskMessageRow>(
    dbPath,
    `SELECT id, role, content, citations_json, fallback, sort_order, created_at_ms
     FROM ask_messages
     ${sqlWhere}
     ORDER BY sort_order DESC, created_at_ms DESC
     LIMIT ${page + 1};`
  );
  const hasMore = rows.length > page;
  const slice = hasMore ? rows.slice(0, page) : rows;
  const messages = slice
    .reverse()
    .map(rowToMessage)
    .filter((m): m is AskChatMessage => Boolean(m));
  return { messages, hasMore };
}

async function nextSortOrderBase(dbPath: string): Promise<number> {
  const rows = await runSqliteJson<{ max_order: number }>(
    dbPath,
    "SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM ask_messages;"
  );
  return rows[0]?.max_order ?? 0;
}

/** Latest messages for Ask UI (most recent first in query, returned chronological). */
export async function listRecentAskMessages(
  dbPath: string,
  options?: { limit?: number }
): Promise<AskChatListResult> {
  return listAskMessagesDescending(dbPath, "", normalizeAskPageLimit(options?.limit));
}

/** Older messages before a sort_order cursor (for scroll-up pagination). */
export async function listOlderAskMessages(
  dbPath: string,
  options: { beforeSortOrder: number; limit?: number }
): Promise<AskChatListResult> {
  const before = Math.max(0, Math.floor(options.beforeSortOrder));
  return listAskMessagesDescending(
    dbPath,
    `WHERE sort_order < ${before}`,
    normalizeAskPageLimit(options.limit)
  );
}

/** @deprecated Use listRecentAskMessages */
export async function listAskMessages(
  dbPath: string,
  options?: { limit?: number }
): Promise<AskChatMessage[]> {
  const result = await listRecentAskMessages(dbPath, options);
  return result.messages;
}

/** Last N user/assistant turns for Meta-Agent prompt context. */
export async function listAskMessagesForHistory(
  dbPath: string,
  maxTurns = 6
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  const { messages } = await listRecentAskMessages(dbPath, { limit: maxTurns * 2 });
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

export async function appendAskTurn(
  dbPath: string,
  turn: {
    userContent: string;
    assistantContent: string;
    citations?: AgentCitation[];
    fallback?: boolean;
  }
): Promise<void> {
  await ensureCatalogSchema(dbPath);
  const base = await nextSortOrderBase(dbPath);
  const userId = randomUUID();
  const assistantId = randomUUID();
  const now = Date.now();
  const citationsJson = turn.citations?.length ? JSON.stringify(turn.citations) : null;
  const fallback = turn.fallback ? 1 : 0;

  await runSqliteTransaction(dbPath, [
    `INSERT INTO ask_messages (id, role, content, citations_json, fallback, sort_order, created_at_ms)
     VALUES (
       '${escapeSqlLiteral(userId)}',
       'user',
       '${escapeSqlLiteral(turn.userContent)}',
       NULL,
       0,
       ${base + 1},
       ${now}
     )`,
    `INSERT INTO ask_messages (id, role, content, citations_json, fallback, sort_order, created_at_ms)
     VALUES (
       '${escapeSqlLiteral(assistantId)}',
       'assistant',
       '${escapeSqlLiteral(turn.assistantContent)}',
       ${citationsJson ? `'${escapeSqlLiteral(citationsJson)}'` : "NULL"},
       ${fallback},
       ${base + 2},
       ${now + 1}
     )`
  ]);
}

export async function clearAskMessages(dbPath: string): Promise<void> {
  await ensureCatalogSchema(dbPath);
  await runSqlite(dbPath, "DELETE FROM ask_messages;");
}