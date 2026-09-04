import { randomUUID } from "node:crypto";
import { escapeSqlLiteral, runSqlite, runSqliteJson } from "../sqlite";

/** Hard cap on stored user text so a pasted blob cannot blow up desktop.db. */
export const COMPOSER_SEND_TEXT_MAX = 32_768;
export const COMPOSER_SEND_LIST_MAX = 100;

export type ComposerSendRecord = {
  id: string;
  createdAtMs: number;
  paneKey: string;
  projectPath: string;
  sessionKey: string | null;
  provider: string | null;
  agentSessionId: string | null;
  text: string;
};

export type ComposerSendAppendInput = {
  paneKey: string;
  projectPath: string;
  sessionKey?: string | null;
  provider?: string | null;
  agentSessionId?: string | null;
  text: string;
  createdAtMs?: number | null;
};

type ComposerSendRow = {
  id: string;
  created_at_ms: number;
  pane_key: string;
  project_path: string;
  session_key: string | null;
  provider: string | null;
  agent_session_id: string | null;
  text: string;
};

function asTrimmedString(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function optionalString(value: unknown, max: number): string | null {
  const next = asTrimmedString(value, max);
  return next ? next : null;
}

function mapRow(row: ComposerSendRow): ComposerSendRecord {
  return {
    id: row.id,
    createdAtMs: row.created_at_ms,
    paneKey: row.pane_key,
    projectPath: row.project_path,
    sessionKey: row.session_key,
    provider: row.provider,
    agentSessionId: row.agent_session_id,
    text: row.text
  };
}

/**
 * Append-only user-send log for Workbench composers. Never UPDATE/DELETE —
 * closing a session only removes the UI, not these rows.
 */
export async function appendComposerSend(
  dbPath: string,
  input: ComposerSendAppendInput
): Promise<ComposerSendRecord> {
  const paneKey = asTrimmedString(input.paneKey, 512);
  const projectPath = asTrimmedString(input.projectPath, 4096);
  const text = asTrimmedString(input.text, COMPOSER_SEND_TEXT_MAX);
  if (!paneKey) throw new Error("composer send requires paneKey");
  if (!projectPath) throw new Error("composer send requires projectPath");
  if (!text) throw new Error("composer send requires text");
  const id = randomUUID();
  const createdAtMs =
    Number.isFinite(input.createdAtMs) && (input.createdAtMs as number) > 0
      ? Math.floor(input.createdAtMs as number)
      : Date.now();
  const sessionKey = optionalString(input.sessionKey, 512);
  const provider = optionalString(input.provider, 64);
  const agentSessionId = optionalString(input.agentSessionId, 512);
  await runSqlite(
    dbPath,
    `INSERT INTO workbench_composer_sends (
       id, created_at_ms, pane_key, project_path, session_key, provider, agent_session_id, text
     ) VALUES (
       '${escapeSqlLiteral(id)}',
       ${createdAtMs},
       '${escapeSqlLiteral(paneKey)}',
       '${escapeSqlLiteral(projectPath)}',
       ${sessionKey ? `'${escapeSqlLiteral(sessionKey)}'` : "NULL"},
       ${provider ? `'${escapeSqlLiteral(provider)}'` : "NULL"},
       ${agentSessionId ? `'${escapeSqlLiteral(agentSessionId)}'` : "NULL"},
       '${escapeSqlLiteral(text)}'
     );`
  );
  return {
    id,
    createdAtMs,
    paneKey,
    projectPath,
    sessionKey,
    provider,
    agentSessionId,
    text
  };
}

export async function listComposerSends(
  dbPath: string,
  options: {
    paneKey?: string;
    sessionKey?: string;
    agentSessionId?: string;
    limit?: number;
  }
): Promise<ComposerSendRecord[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 8, COMPOSER_SEND_LIST_MAX));
  const paneKey = optionalString(options.paneKey, 512);
  const sessionKey = optionalString(options.sessionKey, 512);
  const agentSessionId = optionalString(options.agentSessionId, 512);
  const clauses: string[] = [];
  if (agentSessionId) clauses.push(`agent_session_id = '${escapeSqlLiteral(agentSessionId)}'`);
  if (sessionKey) clauses.push(`session_key = '${escapeSqlLiteral(sessionKey)}'`);
  if (paneKey) {
    clauses.push(
      agentSessionId || sessionKey
        ? `(session_key IS NULL AND agent_session_id IS NULL AND pane_key = '${escapeSqlLiteral(paneKey)}')`
        : `pane_key = '${escapeSqlLiteral(paneKey)}'`
    );
  }
  const where = clauses.length ? `WHERE ${clauses.join(" OR ")}` : "";
  const rows = await runSqliteJson<ComposerSendRow>(
    dbPath,
    `SELECT id, created_at_ms, pane_key, project_path, session_key, provider, agent_session_id, text
     FROM workbench_composer_sends
     ${where}
     ORDER BY created_at_ms DESC, id DESC
     LIMIT ${limit};`
  );
  return rows.map(mapRow);
}
