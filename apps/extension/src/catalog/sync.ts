import { syncAgentSessions, type AgentSessionSyncOptions } from "@agent-resume/core/extension";
import { HistoryLoadOptions, HistoryLoadResult } from "../history/types";
import { CatalogSettings } from "./types";

/** VS Code configuration adapter for the shared Core synchronizer. */
export async function syncCatalog(
  loadOptions: HistoryLoadOptions,
  catalog: CatalogSettings
): Promise<HistoryLoadResult> {
  const options: AgentSessionSyncOptions = {
    ...loadOptions,
    dbPath: catalog.dbPath,
    maxItems: Math.max(loadOptions.maxItems, catalog.syncMaxItems),
    stalePolicy: catalog.stalePolicy
  };
  const result = await syncAgentSessions(options);
  return {
    sessions: result.sessions,
    warnings: result.warnings
  };
}
