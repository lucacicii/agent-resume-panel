import * as path from "node:path";
import { AgentSession } from "../types";
import { escapeSqlLiteral, runSqliteReadOnlyJson } from "../sqlite";
import { PreviewHomes, SessionPreviewResult } from "./types";
import { extractTextFromContent, finalizePreviewMessages, isUserOrAssistantRole } from "./text";

interface AlmaMessageRow {
  message: string;
  timestamp: string;
}

interface AlmaMessagePart {
  type?: string;
  text?: string;
}

interface AlmaMessagePayload {
  role?: string;
  parts?: AlmaMessagePart[];
  content?: unknown;
}

export async function previewAlmaSession(
  session: AgentSession,
  homes: PreviewHomes
): Promise<SessionPreviewResult> {
  const dbPath = path.join(homes.almaHome, "chat_threads.db");
  const sql = `
    SELECT message, timestamp
    FROM chat_messages
    WHERE thread_id = '${escapeSqlLiteral(session.id)}'
    ORDER BY created_at ASC, timestamp ASC
  `;

  const rows = await runSqliteReadOnlyJson<AlmaMessageRow>(dbPath, sql);
  if (!rows.length) {
    throw new Error("Alma transcript not found for this session.");
  }

  const messages: SessionPreviewResult["messages"] = [];
  for (const row of rows) {
    let payload: AlmaMessagePayload;
    try {
      payload = JSON.parse(row.message) as AlmaMessagePayload;
    } catch {
      continue;
    }

    if (!isUserOrAssistantRole(payload.role)) {
      continue;
    }

    const thinking = Array.isArray(payload.parts)
      ? payload.parts
          .filter((part) => part?.type === "reasoning" && typeof part.text === "string" && part.text.trim())
          .map((part) => part.text!.trim())
          .join("\n\n")
          .trim()
      : "";

    const text = (
      extractTextFromContent(payload.parts) ||
      extractTextFromContent(payload.content) ||
      (typeof payload.content === "string" ? payload.content : "")
    ).trim();

    if (!text && !thinking) {
      continue;
    }

    messages.push({
      role: payload.role,
      text,
      thinking: thinking || undefined,
      timestamp: row.timestamp
    });
  }

  if (!messages.length) {
    throw new Error("Alma transcript is empty for this session.");
  }

  return finalizePreviewMessages(session.title, messages);
}
