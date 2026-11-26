import { setUserTitleIfUnsetInCatalog } from "@agent-resume/core/extension";
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

/**
 * Rename a session only if catalog user_title is still unset, avoiding races with manual renames.
 */
export async function renameSessionIfUnsetWithCatalog(
  session: AgentSession,
  newTitle: string,
  homes: RenameHomes
): Promise<boolean> {
  if (session.provider === "chat") {
    return false;
  }

  const catalog = loadCatalogSettings();
  const updated = await setUserTitleIfUnsetInCatalog(catalog.dbPath, session.provider, session.id, newTitle);
  if (!updated) {
    return false;
  }

  await renameSession(session, newTitle, homes);
  return true;
}