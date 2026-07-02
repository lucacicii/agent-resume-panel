import { loadAllSessions } from "../history";
import { AgentSession, HistoryLoadOptions, HistoryLoadResult } from "../history/types";
import { escapeSqlLiteral, runSqlite } from "../history/sqlite";
import { ensureCatalogSchema } from "./db";
import { syncTranscriptRefs } from "./transcript/syncRefs";
import { CatalogSettings, fromAgentSession } from "./types";

const UPSERT_BATCH_SIZE = 80;

export async function syncCatalog(
  loadOptions: HistoryLoadOptions,
  catalog: CatalogSettings
): Promise<HistoryLoadResult> {
  await ensureCatalogSchema(catalog.dbPath);

  const syncOptions: HistoryLoadOptions = {
    ...loadOptions,
    maxItems: Math.max(loadOptions.maxItems, catalog.syncMaxItems)
  };

  const result = await loadAllSessions(syncOptions);
  const syncTimeMs = Date.now();
  await upsertSessions(catalog.dbPath, result.sessions, syncTimeMs);
  await syncTranscriptRefs(catalog.dbPath, result.sessions, syncOptions);
  await applyStalePolicy(catalog.dbPath, catalog.stalePolicy, syncTimeMs);
  await runSqlite(
    catalog.dbPath,
    `INSERT INTO sync_state(provider, last_sync_at_ms) VALUES('catalog', ${syncTimeMs})
     ON CONFLICT(provider) DO UPDATE SET last_sync_at_ms = excluded.last_sync_at_ms;`
  );

  return result;
}

async function upsertSessions(dbPath: string, sessions: AgentSession[], syncTimeMs: number): Promise<void> {
  for (let index = 0; index < sessions.length; index += UPSERT_BATCH_SIZE) {
    const batch = sessions.slice(index, index + UPSERT_BATCH_SIZE);
    const statements = batch.map((session) => buildUpsertSql(fromAgentSession(session, syncTimeMs)));
    await runSqlite(dbPath, `BEGIN;\n${statements.join("\n")}\nCOMMIT;`);
  }
}

function buildUpsertSql(row: ReturnType<typeof fromAgentSession>): string {
  const p = sqlLiteral(row.provider);
  const id = sqlLiteral(row.agent_session_id);
  const title = sqlLiteral(row.title);
  const projectPath = sqlLiteral(row.project_path);
  const model = sqlNullable(row.model);
  const branch = sqlNullable(row.branch);
  const source = sqlNullable(row.source);
  const acpProvider = sqlNullable(row.acp_provider);

  return `INSERT INTO sessions (
    provider, agent_session_id, title, project_path, updated_at_ms, archived,
    message_count, model, branch, source, acp_provider, hidden, last_synced_at_ms
  ) VALUES (
    ${p}, ${id}, ${title}, ${projectPath}, ${row.updated_at_ms}, ${row.archived},
    ${sqlNullableNumber(row.message_count)}, ${model}, ${branch}, ${source}, ${acpProvider}, 0, ${row.last_synced_at_ms}
  ) ON CONFLICT(provider, agent_session_id) DO UPDATE SET
    title = excluded.title,
    project_path = excluded.project_path,
    updated_at_ms = excluded.updated_at_ms,
    archived = excluded.archived,
    message_count = excluded.message_count,
    model = excluded.model,
    branch = excluded.branch,
    source = excluded.source,
    acp_provider = excluded.acp_provider,
    last_synced_at_ms = excluded.last_synced_at_ms,
    user_title = sessions.user_title;`;
}

async function applyStalePolicy(
  dbPath: string,
  stalePolicy: CatalogSettings["stalePolicy"],
  syncTimeMs: number
): Promise<void> {
  const where = `WHERE (last_synced_at_ms IS NULL OR last_synced_at_ms < ${syncTimeMs})`;
  if (stalePolicy === "purge") {
    await runSqlite(dbPath, `DELETE FROM sessions ${where};`);
    return;
  }

  await runSqlite(dbPath, `UPDATE sessions SET hidden = 1 ${where};`);
}

function sqlLiteral(value: string): string {
  return `'${escapeSqlLiteral(value)}'`;
}

function sqlNullable(value: string | null): string {
  return value == null ? "NULL" : sqlLiteral(value);
}

function sqlNullableNumber(value: number | null): string {
  return value == null ? "NULL" : String(value);
}