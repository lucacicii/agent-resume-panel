import { AgentSession } from "../history/types";
import { runSqliteJson } from "../history/sqlite";
import { CatalogSessionRow, CatalogSettings, toAgentSession } from "./types";

export async function querySidebarSessions(catalog: CatalogSettings, maxItems: number): Promise<AgentSession[]> {
  const limit = catalog.sidebarMode === "full" ? Math.max(maxItems, catalog.syncMaxItems) : maxItems;
  return queryVisibleSessions(catalog.dbPath, limit);
}

export async function queryCatalogSessions(catalog: CatalogSettings): Promise<AgentSession[]> {
  return queryVisibleSessions(catalog.dbPath, catalog.syncMaxItems);
}

export async function querySessionById(
  dbPath: string,
  provider: AgentSession["provider"],
  id: string
): Promise<AgentSession | undefined> {
  const rows = await runSqliteJson<CatalogSessionRow>(
    dbPath,
    `SELECT provider, agent_session_id, title, project_path, updated_at_ms, archived,
      message_count, model, branch, source, acp_provider, user_title, hidden, last_synced_at_ms
     FROM sessions
     WHERE provider = '${escapeProvider(provider)}' AND agent_session_id = '${escapeId(id)}' AND hidden = 0
     LIMIT 1;`
  );

  const row = rows[0];
  return row ? toAgentSession(row) : undefined;
}

async function queryVisibleSessions(dbPath: string, limit: number): Promise<AgentSession[]> {
  const safeLimit = Math.max(1, Math.min(limit, 50_000));
  const rows = await runSqliteJson<CatalogSessionRow>(
    dbPath,
    `SELECT provider, agent_session_id, title, project_path, updated_at_ms, archived,
      message_count, model, branch, source, acp_provider, user_title, hidden, last_synced_at_ms
     FROM sessions
     WHERE hidden = 0
     ORDER BY updated_at_ms DESC
     LIMIT ${safeLimit};`
  );

  return rows.map(toAgentSession);
}

function escapeProvider(provider: string): string {
  return provider.replaceAll("'", "''");
}

function escapeId(id: string): string {
  return id.replaceAll("'", "''");
}