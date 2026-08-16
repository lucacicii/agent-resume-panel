import * as path from "node:path";
import { AgentSession } from "../types";
import { readJsonLines } from "../jsonl";
import { PreviewHomes, SessionPreviewResult } from "./types";
import { extractPreviewContent, finalizePreviewMessages, isUserOrAssistantRole } from "./text";
import { listJsonlFiles } from "./fs";

interface ClaudeProjectRow {
  type?: string;
  sessionId?: string;
  isMeta?: boolean;
  timestamp?: string;
  message?: {
    role?: string;
    content?: unknown;
  };
}

export async function previewClaudeSession(
  session: AgentSession,
  homes: PreviewHomes
): Promise<SessionPreviewResult> {
  const projectRoot = path.join(homes.claudeHome, "projects");
  const files = await listJsonlFiles(projectRoot);
  const messages: SessionPreviewResult["messages"] = [];

  for (const file of files) {
    const rows = await readJsonLines<ClaudeProjectRow>(file);
    const sessionIds = new Set(rows.map((row) => row.sessionId).filter(Boolean) as string[]);
    const fileId = path.basename(file, ".jsonl");
    if (!sessionIds.has(session.id) && fileId !== session.id) {
      continue;
    }

    for (const row of rows) {
      if (row.isMeta) {
        continue;
      }
      if (row.type !== "user" && row.type !== "assistant") {
        continue;
      }
      if (!isUserOrAssistantRole(row.type)) {
        continue;
      }

      const extracted = extractPreviewContent(row.message?.content);
      if (!extracted.text && !extracted.thinking) {
        continue;
      }

      messages.push({
        role: row.type,
        text: extracted.text,
        thinking: extracted.thinking || undefined,
        timestamp: row.timestamp
      });
    }

    if (messages.length) {
      return finalizePreviewMessages(session.title, messages);
    }
  }

  throw new Error("Claude transcript not found for this session.");
}