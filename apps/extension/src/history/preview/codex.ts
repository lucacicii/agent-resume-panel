import * as path from "node:path";
import { AgentSession } from "../types";
import { readJsonLines } from "../jsonl";
import { PreviewHomes, SessionPreviewResult } from "./types";
import { extractPreviewContent, finalizePreviewMessages, isUserOrAssistantRole } from "./text";
import { listJsonlFiles } from "./fs";

interface CodexRolloutRow {
  timestamp?: string;
  type?: string;
  payload?: {
    id?: string;
    type?: string;
    role?: string;
    content?: unknown;
  };
}

export async function previewCodexSession(
  session: AgentSession,
  homes: PreviewHomes
): Promise<SessionPreviewResult> {
  const roots = [
    path.join(homes.codexHome, "sessions"),
    path.join(homes.codexHome, "archived_sessions")
  ];

  const rolloutFiles: string[] = [];
  for (const root of roots) {
    const files = await listJsonlFiles(root);
    rolloutFiles.push(...files.filter((file) => path.basename(file).startsWith("rollout-")));
  }

  const matching = rolloutFiles.filter((file) => path.basename(file).includes(session.id));
  if (!matching.length) {
    throw new Error("Codex rollout transcript not found for this session.");
  }

  const messages: SessionPreviewResult["messages"] = [];
  for (const file of matching) {
    const rows = await readJsonLines<CodexRolloutRow>(file);
    for (const row of rows) {
      if (row.type !== "response_item" || !row.payload) {
        continue;
      }
      if (row.payload.type !== "message") {
        continue;
      }
      if (!isUserOrAssistantRole(row.payload.role)) {
        continue;
      }

      const extracted = extractPreviewContent(row.payload.content);
      if (!extracted.text && !extracted.thinking) {
        continue;
      }

      messages.push({
        role: row.payload.role,
        text: extracted.text,
        thinking: extracted.thinking || undefined,
        timestamp: row.timestamp
      });
    }
  }

  if (!messages.length) {
    throw new Error("Codex transcript is empty for this session.");
  }

  return finalizePreviewMessages(session.title, messages);
}