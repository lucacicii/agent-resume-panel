import * as path from "node:path";
import { catalogDbPath } from "../panelHome";
import { escapeSqlLiteral, runSqlite, runSqliteJson } from "../sqlite";

export interface AcpCatalogRecordInput {
  id: string;
  title: string;
  projectPath: string;
  /** Underlying ACP agent: codex | claude | grok | opencode | pi */
  acpProvider: string;
  updatedAt: number;
  messageCount?: number;
  model?: string;
}

export function acpThreadRelPath(sessionId: string): string {
  return path.join("acp", "threads", `${sessionId}.jsonl`);
}

export function acpSessionsIndexRelPath(): string {
  return path.join("acp", "sessions.jsonl");
}

/** Absolute transcript_refs JSON stored on the catalog row. */
export function buildAcpTranscriptRefs(panelHome: string, sessionId: string): string {
  return JSON.stringify({
    kind: "acp",
    threadPath: path.join(panelHome, acpThreadRelPath(sessionId)),
    sessionsIndexPath: path.join(panelHome, acpSessionsIndexRelPath())
  });
}

function sql(value: string): string {
  return `'${escapeSqlLiteral(value)}'`;
}

function nullable(value: string | undefined | null): string {
  const trimmed = value?.trim();
  return trimmed ? sql(trimmed) : "NULL";
}

function numberOrNull(value: number | undefined | null): string {
  if (value == null || !Number.isFinite(value)) return "NULL";
  return String(Math.floor(value));
}

/**
 * Upsert one ACP chat into catalog.sessions as provider=chat.
 * Does not overwrite user_title, hidden, session_summary, or project_id.
 */
export async function upsertAcpSessionInCatalog(
  dbPath: string,
  panelHome: string,
  record: AcpCatalogRecordInput,
  syncTimeMs = Date.now()
): Promise<void> {
  const id = record.id.trim();
  if (!id) return;
  const title = (record.title || id).trim() || id;
  const projectPath = (record.projectPath || "").trim() || panelHome;
  const acpProvider = (record.acpProvider || "").trim() || "claude";
  const model = (record.model || acpProvider).trim();
  const updatedAt = Math.floor(record.updatedAt || Date.now());
  const messageCount = record.messageCount;
  const refs = buildAcpTranscriptRefs(panelHome, id);

  await runSqlite(
    dbPath,
    `INSERT INTO sessions (
      provider, agent_session_id, title, project_path, updated_at_ms, archived, message_count, model, branch,
      source, acp_provider, hidden, last_synced_at_ms, transcript_kind, transcript_refs
    ) VALUES (
      'chat', ${sql(id)}, ${sql(title)}, ${sql(projectPath)}, ${updatedAt}, 0,
      ${numberOrNull(messageCount)}, ${nullable(model)}, NULL,
      'acp', ${sql(acpProvider)}, 0, ${syncTimeMs}, 'acp', ${sql(refs)}
    )
    ON CONFLICT(provider, agent_session_id) DO UPDATE SET
      title=excluded.title,
      project_path=excluded.project_path,
      updated_at_ms=excluded.updated_at_ms,
      message_count=excluded.message_count,
      model=excluded.model,
      source=excluded.source,
      acp_provider=excluded.acp_provider,
      last_synced_at_ms=excluded.last_synced_at_ms,
      transcript_kind=excluded.transcript_kind,
      transcript_refs=excluded.transcript_refs;`
  );
}

/** Hard-delete catalog row when ACP JSONL session is deleted. */
export async function deleteAcpSessionFromCatalog(dbPath: string, sessionId: string): Promise<void> {
  const id = sessionId.trim();
  if (!id) return;
  await runSqlite(
    dbPath,
    `DELETE FROM sessions WHERE provider = 'chat' AND agent_session_id = ${sql(id)};`
  );
  // Best-effort satellite cleanup
  try {
    await runSqlite(dbPath, `DELETE FROM session_gtd WHERE provider = 'chat' AND agent_session_id = ${sql(id)};`);
  } catch {
    /* optional */
  }
}

/**
 * Upsert all ACP store records into catalog (idempotent backfill / sync bridge).
 * Returns number of records processed.
 */
export async function syncAcpRecordsIntoCatalog(
  dbPath: string,
  panelHome: string,
  records: AcpCatalogRecordInput[],
  syncTimeMs = Date.now()
): Promise<number> {
  let count = 0;
  for (const record of records) {
    await upsertAcpSessionInCatalog(dbPath, panelHome, record, syncTimeMs);
    count += 1;
  }
  // Refresh sync_state for chat (best-effort; desktop may have extended columns).
  try {
    await runSqlite(
      dbPath,
      `INSERT INTO sync_state(provider, last_sync_at_ms) VALUES('chat', ${syncTimeMs})
       ON CONFLICT(provider) DO UPDATE SET last_sync_at_ms=excluded.last_sync_at_ms;`
    );
  } catch {
    /* older schema */
  }
  try {
    await runSqlite(
      dbPath,
      `UPDATE sync_state SET status='ok', session_count=${count}, warning=NULL WHERE provider='chat';`
    );
  } catch {
    /* optional extended columns */
  }
  return count;
}

export function catalogDbForPanelHome(panelHome: string): string {
  return catalogDbPath(panelHome);
}

/** Diagnostic: count chat rows in catalog. */
export async function countAcpCatalogSessions(dbPath: string): Promise<number> {
  const rows = await runSqliteJson<{ n: number }>(
    dbPath,
    `SELECT COUNT(*) AS n FROM sessions WHERE provider = 'chat' AND IFNULL(hidden, 0) = 0;`
  );
  return Number(rows[0]?.n) || 0;
}
