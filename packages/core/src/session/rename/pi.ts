import * as fs from "node:fs/promises";
import * as path from "node:path";
import { AgentSession } from "../../catalog/types";
import { isNodeError } from "../../transcript/jsonl";

interface JsonlSessionHeader {
  type?: string;
  id?: string;
}

interface JsonlSessionInfoEntry {
  type?: string;
  name?: string;
  timestamp?: string;
}

export async function renamePiSession(
  piHome: string,
  session: AgentSession,
  title: string
): Promise<void> {
  await renameJsonlSession(path.join(piHome, "sessions"), session, title, "Pi");
}

export async function renamePrimeSession(
  primeHome: string,
  session: AgentSession,
  title: string
): Promise<void> {
  await renameJsonlSession(path.join(primeHome, "sessions"), session, title, "Prime Agent");
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

  let header: JsonlSessionHeader;
  try {
    header = JSON.parse(lines[0].trim()) as JsonlSessionHeader;
  } catch {
    throw new Error(`${providerLabel} session header is invalid: ${sessionPath}`);
  }

  if (header.type !== "session" || header.id !== session.id) {
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

    if (entry.type !== "session_info") {
      return line;
    }

    updated = true;
    return JSON.stringify({ ...entry, name: title });
  });

  if (!updated) {
    nextLines.splice(
      1,
      0,
      JSON.stringify({ type: "session_info", name: title, timestamp: new Date().toISOString() })
    );
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

    const firstLine = content
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean);
    if (!firstLine) {
      continue;
    }

    let header: JsonlSessionHeader;
    try {
      header = JSON.parse(firstLine) as JsonlSessionHeader;
    } catch {
      continue;
    }

    if (header.type === "session" && header.id === sessionId) {
      return sessionPath;
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
