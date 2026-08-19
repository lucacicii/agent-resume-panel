import * as path from "node:path";
import { AgentSession } from "../types";
import { readJsonLines } from "../jsonl";
import { PreviewHomes, SessionPreviewResult } from "./types";
import { extractPreviewContent, finalizePreviewMessages, isUserOrAssistantRole } from "./text";
import { findFilesByName } from "./fs";

interface GrokChatRow {
  type?: string;
  role?: string;
  content?: unknown;
  timestamp?: string;
}

export async function previewGrokSession(
  session: AgentSession,
  homes: PreviewHomes
): Promise<SessionPreviewResult> {
  const sessionsRoot = path.join(homes.grokHome, "sessions");
  const chatFiles = await findFilesByName(sessionsRoot, "chat_history.jsonl");
  const matching = chatFiles.filter((file) => file.includes(session.id) || path.dirname(file).endsWith(session.id));

  if (!matching.length) {
    throw new Error("Grok chat_history.jsonl not found for this session.");
  }

  const messages: SessionPreviewResult["messages"] = [];
  for (const file of matching) {
    const rows = await readJsonLines<GrokChatRow>(file);
    for (const row of rows) {
      const role = row.type ?? row.role;
      if (!isUserOrAssistantRole(role)) {
        continue;
      }

      const extracted = extractPreviewContent(row.content);
      if (!extracted.text && !extracted.thinking) {
        continue;
      }

      messages.push({
        role,
        text: extracted.text,
        thinking: extracted.thinking || undefined,
        timestamp: row.timestamp
      });
    }
  }

  if (!messages.length) {
    throw new Error("Grok transcript is empty for this session.");
  }

  return finalizePreviewMessages(session.title, messages);
}