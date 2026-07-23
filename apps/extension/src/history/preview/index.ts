import { AgentSession } from "../types";
import { RenameHomes } from "../rename";
import { previewAgySession } from "./agy";
import { previewClaudeSession } from "./claude";
import { previewCodexSession } from "./codex";
import { previewCursorSession } from "./cursor";
import { previewGrokSession } from "./grok";
import { previewOpenCodeSession } from "./opencode";
import { previewPiSession } from "./pi";
import { SessionPreviewResult } from "./types";

export type { PreviewMessage, SessionPreviewResult } from "./types";

export async function loadSessionPreview(
  session: AgentSession,
  homes: RenameHomes
): Promise<SessionPreviewResult> {
  switch (session.provider) {
    case "codex":
      return previewCodexSession(session, homes);
    case "claude":
      return previewClaudeSession(session, homes);
    case "agy":
      return previewAgySession(session, homes);
    case "grok":
      return previewGrokSession(session, homes);
    case "opencode":
      return previewOpenCodeSession(session, homes);
    case "pi":
      return previewPiSession(session, homes);
    case "cursor":
      return previewCursorSession(session, homes);
    default:
      throw new Error(`Preview is not supported for provider ${session.provider}.`);
  }
}
