import * as path from "node:path";
import { AgentSession } from "../catalog/types";
import { escapeSqlLiteral, runSqliteJson } from "../sqlite";
import { PreviewHomes, SessionPreviewResult } from "./types";
import { finalizePreviewMessages, isUserOrAssistantRole } from "./text";

interface OpenCodeMessageRow {
  id: string;
  time_created: number;
  data: string;
}

interface OpenCodePartRow {
  message_id: string;
  data: string;
}

interface OpenCodeMessageData {
  role?: string;
}

interface OpenCodePartData {
  type?: string;
  text?: string;
}

type OpenCodePartBucket = {
  text: string[];
  thinking: string[];
};

export async function previewOpenCodeSession(
  session: AgentSession,
  homes: PreviewHomes
): Promise<SessionPreviewResult> {
  const dbPath = path.join(homes.opencodeHome, "opencode.db");
  const messageSql = `
    select id, time_created, data
    from message
    where session_id = '${escapeSqlLiteral(session.id)}'
    order by time_created asc
  `;
  const messages = await runSqliteJson<OpenCodeMessageRow>(dbPath, messageSql);
  if (!messages.length) {
    throw new Error("OpenCode transcript not found for this session.");
  }

  const partSql = `
    select message_id, data
    from part
    where session_id = '${escapeSqlLiteral(session.id)}'
    order by time_created asc
  `;
  const parts = await runSqliteJson<OpenCodePartRow>(dbPath, partSql);
  const partsByMessage = new Map<string, OpenCodePartBucket>();

  for (const part of parts) {
    let payload: OpenCodePartData;
    try {
      payload = JSON.parse(part.data) as OpenCodePartData;
    } catch {
      continue;
    }
    const text = payload.text?.trim();
    if (!text) continue;
    const bucket = partsByMessage.get(part.message_id) ?? { text: [], thinking: [] };
    if (payload.type === "reasoning" || payload.type === "thinking") {
      bucket.thinking.push(text);
    } else if (payload.type === "text") {
      bucket.text.push(text);
    } else {
      continue;
    }
    partsByMessage.set(part.message_id, bucket);
  }

  const previewMessages: SessionPreviewResult["messages"] = [];
  for (const message of messages) {
    let payload: OpenCodeMessageData;
    try {
      payload = JSON.parse(message.data) as OpenCodeMessageData;
    } catch {
      continue;
    }
    if (!isUserOrAssistantRole(payload.role)) {
      continue;
    }

    const bucket = partsByMessage.get(message.id);
    const text = (bucket?.text ?? []).join("\n").trim();
    const thinking = (bucket?.thinking ?? []).join("\n\n").trim();
    if (!text && !thinking) {
      continue;
    }

    previewMessages.push({
      role: payload.role,
      text,
      thinking: thinking || undefined,
      timestamp: new Date(message.time_created).toISOString()
    });
  }

  if (!previewMessages.length) {
    throw new Error("OpenCode transcript is empty for this session.");
  }

  return finalizePreviewMessages(session.title, previewMessages);
}