import { escapeSqlLiteral, runSqlite, runSqliteJson, runSqliteReadOnlyJson } from "../sqlite";
import { ensureExtensionCatalogSchema } from "./db";
import { AgentProvider, AgentSession, CatalogSessionRow, toAgentSession } from "./types";

export const AUTO_RENAME_CLAIM_TTL_MS = 5 * 60 * 1000;
export const AUTO_RENAME_MAX_ATTEMPTS = 2;

const MAX_ERROR_LENGTH = 500;

export interface AutoRenameCandidateQueryOptions {
  sinceMs: number;
  minMessages: number;
  limit: number;
  nowMs?: number;
}

function truncateError(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length <= MAX_ERROR_LENGTH) {
    return trimmed;
  }
  return trimmed.slice(0, MAX_ERROR_LENGTH);
}

/**
 * List recent unrenamed CLI sessions eligible for background auto-renaming.
 */
export async function listBackgroundAutoRenameCandidates(
  dbPath: string,
  options: AutoRenameCandidateQueryOptions
): Promise<AgentSession[]> {
  await ensureExtensionCatalogSchema(dbPath);
  const nowMs = Math.floor(options.nowMs ?? Date.now());
  const sinceMs = Math.floor(options.sinceMs);
  const minMessages = Math.max(0, Math.floor(options.minMessages));
  const limit = Math.max(1, Math.floor(options.limit));
  const staleBefore = nowMs - AUTO_RENAME_CLAIM_TTL_MS;

  const rows = await runSqliteReadOnlyJson<CatalogSessionRow>(
    dbPath,
    `SELECT s.provider, s.agent_session_id, s.title, s.project_path, s.updated_at_ms, s.archived,
      s.message_count, s.model, s.branch, s.source, s.acp_provider, s.user_title, s.hidden, s.last_synced_at_ms,
      s.session_summary, s.session_summary_language, s.session_summary_at_ms, s.project_id, s.native_project_path,
      s.last_exit_waiting
     FROM sessions s
     LEFT JOIN session_auto_rename_state r
       ON r.provider = s.provider AND r.agent_session_id = s.agent_session_id
     WHERE s.hidden = 0
       AND s.archived = 0
       AND s.provider != 'chat'
       AND (s.user_title IS NULL OR TRIM(s.user_title) = '')
       AND s.updated_at_ms >= ${sinceMs}
       AND COALESCE(s.message_count, 0) >= ${minMessages}
       AND LOWER(COALESCE(s.source, '')) NOT LIKE '%subagent%'
       AND (
         r.status IS NULL
         OR (r.status = 'failed' AND r.attempts < ${AUTO_RENAME_MAX_ATTEMPTS})
         OR (r.status = 'claimed' AND COALESCE(r.claimed_at_ms, 0) <= ${staleBefore})
       )
     ORDER BY s.updated_at_ms DESC
     LIMIT ${limit};`
  );

  return rows.map((row) => toAgentSession(row));
}

/**
 * Atomically claim a session for background auto-renaming across processes/windows.
 * Returns true only if this caller acquired the claim and user_title is still unset.
 */
export async function claimSessionAutoRename(
  dbPath: string,
  provider: AgentProvider,
  sessionId: string,
  nowMs = Date.now()
): Promise<boolean> {
  await ensureExtensionCatalogSchema(dbPath);
  const now = Math.floor(nowMs);
  const staleBefore = now - AUTO_RENAME_CLAIM_TTL_MS;
  const escapedProvider = escapeSqlLiteral(provider);
  const escapedSessionId = escapeSqlLiteral(sessionId);

  const result = await runSqliteJson<{ changes: number }>(
    dbPath,
    `INSERT INTO session_auto_rename_state (
       provider, agent_session_id, status, attempts, last_error, claimed_at_ms, updated_at_ms
     )
     SELECT s.provider, s.agent_session_id, 'claimed', 0, NULL, ${now}, ${now}
     FROM sessions s
     WHERE s.provider = '${escapedProvider}'
       AND s.agent_session_id = '${escapedSessionId}'
       AND (s.user_title IS NULL OR TRIM(s.user_title) = '')
     ON CONFLICT(provider, agent_session_id) DO UPDATE SET
       status = 'claimed',
       claimed_at_ms = excluded.claimed_at_ms,
       updated_at_ms = excluded.updated_at_ms
     WHERE (session_auto_rename_state.status = 'failed' AND session_auto_rename_state.attempts < ${AUTO_RENAME_MAX_ATTEMPTS})
        OR (session_auto_rename_state.status = 'claimed' AND COALESCE(session_auto_rename_state.claimed_at_ms, 0) <= ${staleBefore});
     SELECT changes() AS changes;`
  );

  return (result[0]?.changes ?? 0) > 0;
}

/**
 * Mark a session as successfully auto-renamed so it will not be processed again.
 */
export async function markSessionAutoRenameDone(
  dbPath: string,
  provider: AgentProvider,
  sessionId: string,
  nowMs = Date.now()
): Promise<void> {
  await ensureExtensionCatalogSchema(dbPath);
  const now = Math.floor(nowMs);
  const escapedProvider = escapeSqlLiteral(provider);
  const escapedSessionId = escapeSqlLiteral(sessionId);

  await runSqlite(
    dbPath,
    `INSERT INTO session_auto_rename_state (
       provider, agent_session_id, status, attempts, last_error, claimed_at_ms, updated_at_ms
     ) VALUES (
       '${escapedProvider}', '${escapedSessionId}', 'done', 0, NULL, NULL, ${now}
     )
     ON CONFLICT(provider, agent_session_id) DO UPDATE SET
       status = 'done',
       last_error = NULL,
       claimed_at_ms = NULL,
       updated_at_ms = ${now};`
  );
}

/**
 * Mark a session as permanently skipped for background auto-renaming.
 */
export async function markSessionAutoRenameSkipped(
  dbPath: string,
  provider: AgentProvider,
  sessionId: string,
  reason?: string,
  nowMs = Date.now()
): Promise<void> {
  await ensureExtensionCatalogSchema(dbPath);
  const now = Math.floor(nowMs);
  const escapedProvider = escapeSqlLiteral(provider);
  const escapedSessionId = escapeSqlLiteral(sessionId);
  const errorSql = reason?.trim() ? `'${escapeSqlLiteral(truncateError(reason))}'` : "NULL";

  await runSqlite(
    dbPath,
    `INSERT INTO session_auto_rename_state (
       provider, agent_session_id, status, attempts, last_error, claimed_at_ms, updated_at_ms
     ) VALUES (
       '${escapedProvider}', '${escapedSessionId}', 'skipped', 0, ${errorSql}, NULL, ${now}
     )
     ON CONFLICT(provider, agent_session_id) DO UPDATE SET
       status = 'skipped',
       last_error = ${errorSql},
       claimed_at_ms = NULL,
       updated_at_ms = ${now};`
  );
}

/**
 * Record a failed background auto-rename attempt; marks skipped after reaching max attempts.
 */
export async function markSessionAutoRenameFailed(
  dbPath: string,
  provider: AgentProvider,
  sessionId: string,
  error: string,
  nowMs = Date.now()
): Promise<void> {
  await ensureExtensionCatalogSchema(dbPath);
  const now = Math.floor(nowMs);
  const escapedProvider = escapeSqlLiteral(provider);
  const escapedSessionId = escapeSqlLiteral(sessionId);
  const escapedError = escapeSqlLiteral(truncateError(error || "Unknown error"));
  const initialStatus = AUTO_RENAME_MAX_ATTEMPTS <= 1 ? "skipped" : "failed";

  await runSqlite(
    dbPath,
    `INSERT INTO session_auto_rename_state (
       provider, agent_session_id, status, attempts, last_error, claimed_at_ms, updated_at_ms
     ) VALUES (
       '${escapedProvider}', '${escapedSessionId}', '${initialStatus}', 1, '${escapedError}', NULL, ${now}
     )
     ON CONFLICT(provider, agent_session_id) DO UPDATE SET
       attempts = session_auto_rename_state.attempts + 1,
       status = CASE
         WHEN session_auto_rename_state.attempts + 1 >= ${AUTO_RENAME_MAX_ATTEMPTS} THEN 'skipped'
         ELSE 'failed'
       END,
       last_error = '${escapedError}',
       claimed_at_ms = NULL,
       updated_at_ms = ${now};`
  );
}

/**
 * Set user_title only if it is currently empty, avoiding races with manual renames.
 */
export async function setUserTitleIfUnsetInCatalog(
  dbPath: string,
  provider: AgentProvider,
  sessionId: string,
  userTitle: string
): Promise<boolean> {
  const title = userTitle.trim();
  if (!title) {
    throw new Error("Session title cannot be empty.");
  }

  await ensureExtensionCatalogSchema(dbPath);
  const result = await runSqliteJson<{ changes: number }>(
    dbPath,
    `UPDATE sessions SET user_title = '${escapeSqlLiteral(title)}'
     WHERE provider = '${escapeSqlLiteral(provider)}'
       AND agent_session_id = '${escapeSqlLiteral(sessionId)}'
       AND (user_title IS NULL OR TRIM(user_title) = '');
     SELECT changes() AS changes;`
  );

  return (result[0]?.changes ?? 0) > 0;
}
