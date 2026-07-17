import { renameSession, RenameHomes } from "../history/rename";
import { AgentSession } from "../history/types";
import { loadCatalogSettings } from "./config";
import { setUserTitleInCatalog } from "./mutations";

/**
 * SQLite-first rename: update catalog display title, then push to the native agent store.
 */
export async function renameSessionWithCatalog(
  session: AgentSession,
  newTitle: string,
  homes: RenameHomes
): Promise<void> {
  if (session.provider !== "chat") {
    const catalog = loadCatalogSettings();
    await setUserTitleInCatalog(catalog.dbPath, session.provider, session.id, newTitle);
  }

  await renameSession(session, newTitle, homes);
}