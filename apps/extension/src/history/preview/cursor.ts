import * as fs from "node:fs/promises";
import * as path from "node:path";
import { AgentSession } from "../types";
import { findFilesByName } from "./fs";
import { extractPreviewContent, finalizePreviewMessages, isUserOrAssistantRole } from "./text";
import { PreviewHomes, SessionPreviewResult } from "./types";

interface CursorTranscriptEntry {
  role?: unknown;
  message?: { content?: unknown };
}

export async function previewCursorSession(
  session: AgentSession,
  homes: PreviewHomes
): Promise<SessionPreviewResult> {
  const files = await findFilesByName(
    path.join(homes.cursorHome, "projects"),
    `${session.id}.jsonl`,
    5
  );

  for (const file of files) {
    if (path.basename(path.dirname(file)) !== session.id) {
      continue;
    }
    const raw = await fs.readFile(file, "utf8");
    const messages: SessionPreviewResult["messages"] = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      let entry: CursorTranscriptEntry;
      try {
        entry = JSON.parse(line) as CursorTranscriptEntry;
      } catch {
        continue;
      }
      if (!isUserOrAssistantRole(entry.role)) {
        continue;
      }
      const extracted = extractPreviewContent(entry.message?.content);
      if (extracted.text || extracted.thinking) {
        messages.push({
          role: entry.role,
          text: extracted.text,
          thinking: extracted.thinking || undefined
        });
      }
    }
    if (messages.length) {
      return finalizePreviewMessages(session.title, messages);
    }
  }

  throw new Error("Cursor CLI transcript not found for this session.");
}
