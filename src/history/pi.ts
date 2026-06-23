import * as fs from "node:fs/promises";
import * as path from "node:path";
import { AgentSession } from "./types";

interface PiSessionHeader {
  type?: string;
  id?: string;
  cwd?: string;
  timestamp?: string;
}

interface PiSessionInfoEntry {
  type?: string;
  name?: string;
  timestamp?: string;
}

interface PiMessageEntry {
  type?: string;
  timestamp?: string;
  message?: {
    role?: string;
    content?: string | Array<{ type?: string; text?: string }>;
  };
}

export async function loadPiSessions(piHome: string, maxItems: number): Promise<AgentSession[]> {
  const sessionsRoot = path.join(piHome, "sessions");
  const sessionPaths = await listSessionFiles(sessionsRoot);
  const sessions: AgentSession[] = [];

  for (const sessionPath of sessionPaths) {
    const session = await parseSessionFile(sessionPath);
    if (session) {
      sessions.push(session);
    }
  }

  return sessions.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, maxItems);
}

async function parseSessionFile(sessionPath: string): Promise<AgentSession | undefined> {
  let content: string;
  try {
    content = await fs.readFile(sessionPath, "utf8");
  } catch {
    return undefined;
  }

  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) {
    return undefined;
  }

  let header: PiSessionHeader;
  try {
    header = JSON.parse(lines[0]) as PiSessionHeader;
  } catch {
    return undefined;
  }

  if (header.type !== "session" || !header.id) {
    return undefined;
  }

  let displayName: string | undefined;
  let firstUserMessage: string | undefined;
  let messageCount = 0;
  let latestTimestamp = Date.parse(header.timestamp ?? "") || 0;

  for (const line of lines.slice(1)) {
    let entry: PiSessionInfoEntry & PiMessageEntry;
    try {
      entry = JSON.parse(line) as PiSessionInfoEntry & PiMessageEntry;
    } catch {
      continue;
    }

    const entryTime = Date.parse(entry.timestamp ?? "");
    if (entryTime > latestTimestamp) {
      latestTimestamp = entryTime;
    }

    if (entry.type === "session_info" && entry.name) {
      displayName = entry.name;
    }

    if (entry.type === "message" && entry.message?.role === "user") {
      messageCount += 1;
      if (!firstUserMessage) {
        firstUserMessage = extractMessageText(entry.message.content);
      }
    }
  }

  if (!latestTimestamp) {
    try {
      latestTimestamp = (await fs.stat(sessionPath)).mtimeMs;
    } catch {
      latestTimestamp = 0;
    }
  }

  const title = cleanTitle(displayName) || cleanTitle(firstUserMessage) || header.id;

  return {
    provider: "pi",
    id: header.id,
    title,
    projectPath: header.cwd?.trim() || process.env.HOME || "",
    updatedAt: latestTimestamp,
    messageCount: messageCount || undefined,
    source: "jsonl"
  };
}

function extractMessageText(content: string | Array<{ type?: string; text?: string }> | undefined): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text)
      .join(" ");
  }

  return "";
}

async function listSessionFiles(root: string): Promise<string[]> {
  const output: string[] = [];

  async function visit(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        output.push(fullPath);
      }
    }
  }

  await visit(root);
  return output;
}

function cleanTitle(input?: string): string {
  return (input ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}