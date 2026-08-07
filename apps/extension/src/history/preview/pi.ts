import * as fs from "node:fs/promises";
import * as path from "node:path";
import { AgentSession } from "../types";
import { PreviewHomes, SessionPreviewResult } from "./types";
import { extractTextFromContent, finalizePreviewMessages, isUserOrAssistantRole } from "./text";
import { listJsonlFiles } from "./fs";

interface JsonlSessionHeader {
  type?: string;
  id?: string;
}

interface JsonlMessageEntry {
  type?: string;
  timestamp?: string;
  message?: {
    role?: string;
    content?: unknown;
  };
}

export async function previewPiSession(session: AgentSession, homes: PreviewHomes): Promise<SessionPreviewResult> {
  return previewJsonlSession(session, path.join(homes.piHome, "sessions"));
}

export async function previewPrimeSession(session: AgentSession, homes: PreviewHomes): Promise<SessionPreviewResult> {
  return previewJsonlSession(session, path.join(homes.primeHome, "sessions"));
}

async function previewJsonlSession(session: AgentSession, sessionsRoot: string): Promise<SessionPreviewResult> {
  const sessionFiles = await listJsonlFiles(sessionsRoot);
  const messages: SessionPreviewResult["messages"] = [];

  for (const file of sessionFiles) {
    let content: string;
    try {
      content = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }

    const lines = content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) {
      continue;
    }

    let header: JsonlSessionHeader;
    try {
      header = JSON.parse(lines[0]) as JsonlSessionHeader;
    } catch {
      continue;
    }

    if (header.type !== "session" || header.id !== session.id) {
      continue;
    }

    for (const line of lines.slice(1)) {
      let entry: JsonlMessageEntry;
      try {
        entry = JSON.parse(line) as JsonlMessageEntry;
      } catch {
        continue;
      }

      if (entry.type !== "message" || !entry.message?.role) {
        continue;
      }
      if (!isUserOrAssistantRole(entry.message.role)) {
        continue;
      }

      const text = extractTextFromContent(entry.message.content);
      if (!text) {
        continue;
      }

      messages.push({
        role: entry.message.role,
        text,
        timestamp: entry.timestamp
      });
    }

    if (messages.length) {
      return finalizePreviewMessages(session.title, messages);
    }
  }

  throw new Error("Session transcript not found for this session.");
}
