import * as fs from "node:fs/promises";
import * as path from "node:path";
import { AgentSession } from "./types";
import { readJsonLines } from "./jsonl";

interface ClaudeHistoryRow {
  display?: string;
  timestamp?: number;
  project?: string;
  sessionId?: string;
}

interface ClaudeProjectRow {
  type?: string;
  sessionId?: string;
  cwd?: string;
  timestamp?: string;
  aiTitle?: string;
  message?: {
    role?: string;
    content?: unknown;
  };
  version?: string;
  gitBranch?: string;
}

export async function loadClaudeSessions(claudeHome: string, maxItems: number): Promise<AgentSession[]> {
  const byId = new Map<string, AgentSession>();

  for (const row of await readJsonLines<ClaudeHistoryRow>(path.join(claudeHome, "history.jsonl"))) {
    if (!row.sessionId) {
      continue;
    }

    upsertLatest(byId, {
      provider: "claude",
      id: row.sessionId,
      title: cleanTitle(row.display) || row.sessionId,
      projectPath: row.project || process.env.HOME || "",
      updatedAt: Number(row.timestamp ?? 0),
      source: "history"
    });
  }

  const projectRoot = path.join(claudeHome, "projects");
  for (const file of await listJsonlFiles(projectRoot)) {
    const rows = await readJsonLines<ClaudeProjectRow>(file);
    const session = summarizeProjectFile(rows, file);
    if (session) {
      upsertLatest(byId, session);
    }
  }

  return [...byId.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, maxItems);
}

function summarizeProjectFile(rows: ClaudeProjectRow[], file: string): AgentSession | undefined {
  let id = path.basename(file, ".jsonl");
  let title = "";
  let projectPath = "";
  let updatedAt = 0;
  let branch: string | undefined;
  let modelOrVersion: string | undefined;

  for (const row of rows) {
    if (row.sessionId) {
      id = row.sessionId;
    }
    if (row.cwd) {
      projectPath = row.cwd;
    }
    if (row.gitBranch) {
      branch = row.gitBranch;
    }
    if (row.version) {
      modelOrVersion = row.version;
    }
    if (row.timestamp) {
      updatedAt = Math.max(updatedAt, Date.parse(row.timestamp) || 0);
    }
    if (!title && row.type === "user") {
      title = contentToTitle(row.message?.content);
    }
    if (!title && row.type === "ai-title") {
      title = cleanTitle(row.aiTitle);
    }
  }

  if (!id) {
    return undefined;
  }

  return {
    provider: "claude",
    id,
    title: cleanTitle(title) || id,
    projectPath: projectPath || projectPathFromClaudeFile(file),
    updatedAt,
    model: modelOrVersion,
    branch,
    source: "project"
  };
}

async function listJsonlFiles(root: string): Promise<string[]> {
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

function contentToTitle(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
          return part.text;
        }
        return "";
      })
      .join(" ");
  }

  return "";
}

function cleanTitle(input?: string): string {
  return (input ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function projectPathFromClaudeFile(file: string): string {
  const projectDir = path.basename(path.dirname(file));
  if (!projectDir.startsWith("-")) {
    return process.env.HOME || "";
  }

  return `/${projectDir.slice(1).replaceAll("-", "/")}`;
}
