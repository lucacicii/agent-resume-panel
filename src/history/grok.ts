import * as fs from "node:fs/promises";
import * as path from "node:path";
import { AgentSession } from "./types";

interface GrokSummary {
  info?: {
    id?: string;
    cwd?: string;
  };
  generated_title?: string;
  session_summary?: string;
  updated_at?: string;
  last_active_at?: string;
  current_model_id?: string;
  head_branch?: string;
  session_kind?: string;
  num_chat_messages?: number;
}

export async function loadGrokSessions(
  grokHome: string,
  maxItems: number,
  showSubagents: boolean
): Promise<AgentSession[]> {
  const sessionsRoot = path.join(grokHome, "sessions");
  const summaryPaths = await listSummaryFiles(sessionsRoot);
  const sessions: AgentSession[] = [];

  for (const summaryPath of summaryPaths) {
    const session = await parseSummaryFile(summaryPath, showSubagents);
    if (session) {
      sessions.push(session);
    }
  }

  return sessions.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, maxItems);
}

async function parseSummaryFile(summaryPath: string, showSubagents: boolean): Promise<AgentSession | undefined> {
  let summary: GrokSummary;
  try {
    summary = JSON.parse(await fs.readFile(summaryPath, "utf8")) as GrokSummary;
  } catch {
    return undefined;
  }

  if (!showSubagents && summary.session_kind === "subagent") {
    return undefined;
  }

  const sessionDir = path.dirname(summaryPath);
  const cwdGroupDir = path.dirname(sessionDir);
  const id = summary.info?.id?.trim() || path.basename(sessionDir);
  if (!id) {
    return undefined;
  }

  const projectPath = await resolveProjectPath(summary, cwdGroupDir);
  const title = cleanTitle(summary.generated_title) || cleanTitle(summary.session_summary) || id;
  const updatedAt = Date.parse(summary.updated_at ?? summary.last_active_at ?? "") || 0;

  return {
    provider: "grok",
    id,
    title,
    projectPath: projectPath || process.env.HOME || "",
    updatedAt,
    model: summary.current_model_id,
    branch: summary.head_branch,
    messageCount: summary.num_chat_messages,
    source: "summary"
  };
}

async function resolveProjectPath(summary: GrokSummary, cwdGroupDir: string): Promise<string> {
  const fromSummary = summary.info?.cwd?.trim();
  if (fromSummary) {
    return fromSummary;
  }

  const cwdFile = path.join(cwdGroupDir, ".cwd");
  try {
    const fromCwdFile = (await fs.readFile(cwdFile, "utf8")).trim();
    if (fromCwdFile) {
      return fromCwdFile;
    }
  } catch {
    // Fall through to encoded directory name.
  }

  return decodeCwdGroup(path.basename(cwdGroupDir));
}

function decodeCwdGroup(encoded: string): string {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

async function listSummaryFiles(root: string): Promise<string[]> {
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
      } else if (entry.isFile() && entry.name === "summary.json") {
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