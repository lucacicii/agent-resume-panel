import * as path from "node:path";
import { AgentSession } from "../catalog/types";
import { readJsonLines } from "./jsonl";
import { PreviewHomes, SessionPreviewResult } from "./types";
import { candidateAgyRoots } from "./agyRoots";
import { finalizePreviewMessages } from "./text";
import type { FinalizePreviewOptions } from "./text";

interface AntigravityHistoryRow {
  display?: string;
  conversationId?: string;
}

export async function previewAgySession(session: AgentSession, homes: PreviewHomes, options?: FinalizePreviewOptions): Promise<SessionPreviewResult> {
  for (const root of candidateAgyRoots(homes.antigravityHome)) {
    const rows = await readJsonLines<AntigravityHistoryRow>(path.join(root, "history.jsonl"));
    const match = rows.filter((row) => row.conversationId === session.id).at(-1);
    if (match?.display?.trim()) {
      return finalizePreviewMessages(
        session.title,
        [{ role: "user", text: match.display.trim() }],
        "Antigravity only exposes limited history metadata for this session; full transcript preview is unavailable.",
        options
      );
    }
  }

  throw new Error("Antigravity transcript not available for this session.");
}