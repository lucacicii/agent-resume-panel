import * as path from "node:path";
import { AgentSession } from "../types";
import { escapeSqlLiteral, runSqliteJson } from "../sqlite";
import { PreviewHomes, SessionPreviewResult } from "./types";
import { extractTextFromContent, finalizePreviewMessages, isUserOrAssistantRole } from "./text";

interface AlmaMessageRow {
  message: string;
  timestamp: string;
}

interface AlmaMessagePayload {
  role?: string;
  parts?: Array<{ type?: string; text?: string }>;
  content?: unknown;
}

export async function previewAlmaSession(
  session: AgentSession,
  homes: PreviewHomes
): Promise<SessionPreviewResult> {
  const dbPath = path.join(homes.almaDataDir, "chat_threads.db");
  const sql = `
    select message, timestamp
    from chat_messages
    where thread_id = '${escapeSqlLiteral(session.id)}'
    order by timestamp asc
  `;

  const rows = await runSqliteJson<AlmaMessageRow>(dbPath, sql);
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

    const text =
      extractTextFromContent(payload.parts) ||
      extractTextFromContent(payload.content) ||
      (typeof payload.content === "string" ? payload.content : "");

    if (!text) {
      continue;
    }

    messages.push({
      role: payload.role,
      text,
      timestamp: row.timestamp
    });
  }

  if (!messages.length) {
    throw new Error("Alma transcript is empty for this session.");
  }

  return finalizePreviewMessages(session.title, messages);
}