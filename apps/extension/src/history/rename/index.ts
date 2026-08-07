import { AgentSession } from "../types";
import { renameAgySession } from "./agy";
import { renameClaudeSession } from "./claude";
import { renameCodexSession } from "./codex";
import { renameGrokSession } from "./grok";
import { renameOpenCodeSession } from "./opencode";
import { renameAcpSession } from "./acp";
import { renamePiSession, renamePrimeSession } from "./pi";

export interface RenameHomes {
  panelHome: string;
  codexHome: string;
  claudeHome: string;
  antigravityHome: string;
  grokHome: string;
  opencodeHome: string;
  piHome: string;
  primeHome: string;
  cursorHome: string;
  cursorIdeUserDataHome: string;
}

function cleanTitle(input: string): string {
  return input.replace(/\s+/g, " ").trim().slice(0, 180);
}

export async function renameSession(
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
    case "agy":
      return renameAgySession(homes.antigravityHome, session, title);
    case "grok":
      return renameGrokSession(homes.grokHome, session, title);
    case "opencode":
      return renameOpenCodeSession(homes.opencodeHome, session, title);
    case "pi":
      return renamePiSession(homes.piHome, session, title);
    case "prime":
      return renamePrimeSession(homes.primeHome, session, title);
    case "cursor":
    case "cursor-ide":
      // Cursor's local session records are catalog-only for title changes.
      return;
    case "chat":
      return renameAcpSession(homes.panelHome, session, title);
    default:
      throw new Error(`Rename is not supported for provider ${session.provider}.`);
  }
}
