import { AgentSession } from "../../catalog/types";
import { PreviewHomes } from "../../transcript/types";
import { renameAgySession } from "./agy";
import { renameClaudeSession } from "./claude";
import { renameCodexSession } from "./codex";
import { renameGrokSession } from "./grok";
import { renameOpenCodeSession } from "./opencode";
import { renamePiSession } from "./pi";

export type RenameHomes = PreviewHomes;

function cleanTitle(input: string): string {
  return input.replace(/\s+/g, " ").trim().slice(0, 180);
}

/** Push title into the native agent store (best-effort per provider). */
export async function renameSessionNative(
  session: AgentSession,
  newTitle: string,
  homes: RenameHomes
): Promise<void> {
  const title = cleanTitle(newTitle);
  if (!title) {
    throw new Error("Session title cannot be empty.");
  }

  switch (session.provider) {
    case "codex":
      return renameCodexSession(homes.codexHome, session, title);
    case "claude":
      return renameClaudeSession(homes.claudeHome, session, title);
    case "cursor":
    case "cursor-ide":
      // Cursor title changes remain local to the catalog.
      return;
    case "agy":
      return renameAgySession(homes.antigravityHome, session, title);
    case "grok":
      return renameGrokSession(homes.grokHome, session, title);
    case "opencode":
      return renameOpenCodeSession(homes.opencodeHome, session, title);
    case "pi":
      return renamePiSession(homes.piHome, session, title);
    case "chat":
      throw new Error("Rename is not supported for ACP chat sessions in Desktop yet.");
    default:
      throw new Error(`Rename is not supported for provider ${session.provider}.`);
  }
}
