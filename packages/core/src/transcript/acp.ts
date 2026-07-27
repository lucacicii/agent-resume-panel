import * as fs from "node:fs/promises";
import * as path from "node:path";
import { AgentSession } from "../catalog/types";
import { MAX_PREVIEW_MESSAGES, PreviewHomes, PreviewMessage, SessionPreviewResult } from "./types";

interface AcpThreadLine {
  id?: string;
  role?: string;
  text?: string;
  timestamp?: number;
}

/**
 * Preview ACP chat from panelHome/acp/threads/{id}.jsonl.
 * Messages remain file-backed; catalog only indexes metadata.
 */
export async function previewAcpSession(
  session: AgentSession,
  homes: PreviewHomes
): Promise<SessionPreviewResult> {
  const threadPath = path.join(homes.panelHome, "acp", "threads", `${session.id}.jsonl`);
  let raw = "";
  try {
    raw = await fs.readFile(threadPath, "utf8");
  } catch (error) {
    if (isMissing(error)) {
      // Thread files are created lazily on first message; absence just means an empty chat.
      return {
        title: session.title || session.id,
        messages: []
      };
    }
    throw error;
  }

  const byId = new Map<string, PreviewMessage & { ts: number }>();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row: AcpThreadLine;
    try {
      row = JSON.parse(trimmed) as AcpThreadLine;
    } catch {
      continue;
    }
    const role = row.role === "assistant" || row.role === "user" ? row.role : null;
    if (!role) continue;
    const text = String(row.text || "").trim();
    if (!text) continue;
    const id = row.id || `${role}-${row.timestamp || byId.size}`;
    byId.set(id, {
      role,
      text,
      timestamp: row.timestamp ? new Date(row.timestamp).toISOString() : undefined,
      ts: Number(row.timestamp) || 0
    });
  }

  const sorted = [...byId.values()].sort((a, b) => a.ts - b.ts);
  const truncated = sorted.length > MAX_PREVIEW_MESSAGES;
  const slice = truncated ? sorted.slice(-MAX_PREVIEW_MESSAGES) : sorted;
  return {
    title: session.title || session.id,
    messages: slice.map(({ role, text, timestamp }) => ({ role, text, timestamp })),
    truncated: truncated || undefined
  };
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT");
}
