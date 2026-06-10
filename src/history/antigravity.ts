import * as fs from "node:fs/promises";
import * as path from "node:path";
import { AgentSession } from "./types";
import { isNodeError, readJsonLines } from "./jsonl";
import { basenameOrPath } from "./pathUtils";

interface AntigravityHistoryRow {
  display?: string;
  timestamp?: number;
  workspace?: string;
  conversationId?: string;
}

type LastConversations = Record<string, string>;

export async function loadAntigravitySessions(antigravityHome: string, maxItems: number): Promise<AgentSession[]> {
  const byId = new Map<string, AgentSession>();
  const roots = candidateRoots(antigravityHome);

  for (const root of roots) {
    await loadHistory(root, byId);
    await loadLastConversations(root, byId);
    await loadConversationFiles(root, byId);
    await loadBrainTasks(root, byId);
  }

  return [...byId.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, maxItems);
}

async function loadHistory(root: string, byId: Map<string, AgentSession>): Promise<void> {
  const rows = await readJsonLines<AntigravityHistoryRow>(path.join(root, "history.jsonl"));

  for (const row of rows) {
    if (!row.conversationId) {
      continue;
    }

    upsertLatest(byId, {
      provider: "agy",
      id: row.conversationId,
      title: cleanTitle(row.display) || row.conversationId,
      projectPath: row.workspace || process.env.HOME || "",
      updatedAt: Number(row.timestamp ?? 0),
      source: "history"
    });
  }
}

async function loadLastConversations(root: string, byId: Map<string, AgentSession>): Promise<void> {
  const lastConversations = await readJson<LastConversations>(path.join(root, "cache", "last_conversations.json"));
  if (!lastConversations) {
    return;
  }

  for (const [workspace, id] of Object.entries(lastConversations)) {
    if (!id) {
      continue;
    }

    upsertFallback(byId, {
      provider: "agy",
      id,
      title: basenameOrPath(workspace) || id,
      projectPath: workspace || process.env.HOME || "",
      updatedAt: await conversationUpdatedAt(root, id),
      source: "last_conversations"
    });
  }
}

async function loadConversationFiles(root: string, byId: Map<string, AgentSession>): Promise<void> {
  const conversationDir = path.join(root, "conversations");
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(conversationDir, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isFile() || (!entry.name.endsWith(".db") && !entry.name.endsWith(".pb"))) {
      continue;
    }
    const id = path.basename(entry.name, path.extname(entry.name));
    if (!id) {
      continue;
    }

    upsertFallback(byId, {
      provider: "agy",
      id,
      title: id,
      projectPath: process.env.HOME || "",
      updatedAt: await fileMtime(path.join(conversationDir, entry.name)),
      source: "conversation"
    });
  }
}

async function loadBrainTasks(root: string, byId: Map<string, AgentSession>): Promise<void> {
  const brainDir = path.join(root, "brain");
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(brainDir, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const taskPath = path.join(brainDir, entry.name, "task.md");
    const title = await taskTitle(taskPath);
    if (!title) {
      continue;
    }

    upsertFallback(byId, {
      provider: "agy",
      id: entry.name,
      title,
      projectPath: process.env.HOME || "",
      updatedAt: await fileMtime(taskPath),
      source: "brain"
    });
  }
}

function upsertLatest(byId: Map<string, AgentSession>, next: AgentSession): void {
  const previous = byId.get(next.id);
  if (!previous || next.updatedAt >= previous.updatedAt) {
    byId.set(next.id, {
      ...previous,
      ...next,
      title: cleanTitle(next.title) || cleanTitle(previous?.title) || next.id,
      projectPath: next.projectPath || previous?.projectPath || process.env.HOME || ""
    });
  }
}

function upsertFallback(byId: Map<string, AgentSession>, next: AgentSession): void {
  const previous = byId.get(next.id);
  if (!previous) {
    byId.set(next.id, {
      ...next,
      title: cleanTitle(next.title) || next.id,
      projectPath: next.projectPath || process.env.HOME || ""
    });
    return;
  }

  byId.set(next.id, {
    ...previous,
    updatedAt: Math.max(previous.updatedAt, next.updatedAt),
    title: shouldReplaceFallbackTitle(previous.title, previous.id) ? cleanTitle(next.title) || previous.title : previous.title,
    projectPath: previous.projectPath || next.projectPath || process.env.HOME || "",
    source: previous.source || next.source
  });
}

function candidateRoots(antigravityHome: string): string[] {
  const normalized = path.resolve(antigravityHome);
  const parent = path.dirname(normalized);
  const base = path.basename(normalized);
  const roots = [normalized, path.join(normalized, "antigravity-cli"), path.join(normalized, "antigravity")];

  if (base === "antigravity-cli" || base === "antigravity") {
    roots.push(path.join(parent, "antigravity-cli"), path.join(parent, "antigravity"));
  }

  return [...new Set(roots)];
}

async function readJson<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function conversationUpdatedAt(root: string, id: string): Promise<number> {
  return Math.max(await fileMtime(path.join(root, "conversations", `${id}.db`)), await fileMtime(path.join(root, "conversations", `${id}.pb`)));
}

async function fileMtime(filePath: string): Promise<number> {
  try {
    return (await fs.stat(filePath)).mtimeMs;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return 0;
    }
    throw error;
  }
}

async function taskTitle(filePath: string): Promise<string> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return "";
    }
    throw error;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.replace(/^#+\s*/, "").trim();
    if (trimmed && trimmed !== "Tasks") {
      return trimmed;
    }
  }

  return "";
}

function shouldReplaceFallbackTitle(title: string, id: string): boolean {
  return !cleanTitle(title) || title === id;
}

function cleanTitle(input?: string): string {
  return (input ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}
