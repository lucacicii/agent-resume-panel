import * as fs from "node:fs/promises";
import * as path from "node:path";
import { AgentSession } from "../types";
import { isNodeError } from "../jsonl";

interface JsonlSessionHeader {
  type?: string;
  id?: string;
}

interface JsonlSessionInfoEntry {
  type?: string;
  name?: string;
  timestamp?: string;
}

export async function renamePiSession(piHome: string, session: AgentSession, title: string): Promise<void> {
  await renameJsonlSession(path.join(piHome, "sessions"), session, title, "Pi");
}

export async function renamePrimeSession(primeHome: string, session: AgentSession, title: string): Promise<void> {
  await renameJsonlSession(path.join(primeHome, "sessions"), session, title, "Prime Agent");
}

export async function renameOmpSession(ompHome: string, session: AgentSession, title: string): Promise<void> {
  await renameJsonlSession(path.join(ompHome, "sessions"), session, title, "OMP");
}

async function renameJsonlSession(
  sessionsRoot: string,
  session: AgentSession,
  title: string,
  providerLabel: string
): Promise<void> {
  const sessionPath = await findJsonlSessionFile(sessionsRoot, session.id);
  if (!sessionPath) {
    throw new Error(`${providerLabel} session file not found for session ${session.id}.`);
  }

  const raw = await fs.readFile(sessionPath, "utf8");
  const lines = raw.split(/\r?\n/);
  if (!lines.length) {
    throw new Error(`${providerLabel} session file is empty: ${sessionPath}`);
  }

  let sessionHeaderIndex = -1;
  let matchedHeader = false;
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed) as JsonlSessionHeader;
      if (entry.type === "session") {
        sessionHeaderIndex = i;
        matchedHeader = entry.id === session.id;
        break;
      }
    } catch {
      // keep scanning
    }
  }
  if (sessionHeaderIndex < 0) {
    throw new Error(`${providerLabel} session header is invalid: ${sessionPath}`);
  }
  if (!matchedHeader) {
    throw new Error(`${providerLabel} session header does not match ${session.id}.`);
  }
  let updated = false;
  const nextLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return line;
    }

    let entry: JsonlSessionInfoEntry;
    try {
      entry = JSON.parse(trimmed) as JsonlSessionInfoEntry;
    } catch {
      return line;
    }

    if (entry.type === "title") {
      updated = true;
      return JSON.stringify({ ...entry, title, updatedAt: new Date().toISOString() });
    }
    if (entry.type !== "session_info") {
      return line;
    }

    updated = true;
    return JSON.stringify({ ...entry, name: title });
  });

  if (!updated) {
    nextLines.splice(sessionHeaderIndex + 1, 0, JSON.stringify({ type: "session_info", name: title, timestamp: new Date().toISOString() }));
  }

  await fs.writeFile(sessionPath, `${nextLines.join("\n")}\n`, "utf8");
}

async function findJsonlSessionFile(root: string, sessionId: string): Promise<string | undefined> {
  const sessionPaths = await listSessionFiles(root);
  for (const sessionPath of sessionPaths) {
    let content: string;
    try {
      content = await fs.readFile(sessionPath, "utf8");
    } catch {
      continue;
    }

    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      try {
        const entry = JSON.parse(line) as JsonlSessionHeader;
        if (entry.type === "session") {
          if (entry.id === sessionId) {
            return sessionPath;
          }
          break;
        }
      } catch {
        continue;
      }
    }
  }

  return undefined;
}

async function listSessionFiles(root: string): Promise<string[]> {
  const output: string[] = [];

  async function visit(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return;
      }
      throw error;
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
