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

interface SummaryFileEntry {
  path: string;
  mtimeMs: number;
}

interface CachedGrokSummary {
  mtimeMs: number;
  summary: GrokSummary;
}

const summaryCache = new Map<string, CachedGrokSummary>();
const readBatchSize = 64;

export async function loadGrokSessions(
  grokHome: string,
  maxItems: number,
  showSubagents: boolean
): Promise<AgentSession[]> {
  const sessionsRoot = path.join(grokHome, "sessions");
  const entries = await listSummaryFileEntries(sessionsRoot);
  const sessions: AgentSession[] = [];

  for (let index = 0; index < entries.length; index += readBatchSize) {
    const batch = entries.slice(index, index + readBatchSize);
    const batchSessions = await Promise.all(batch.map((entry) => parseSummaryEntry(entry, showSubagents)));
    for (const session of batchSessions) {
      if (session) {
        sessions.push(session);
      }
    }
  }

  pruneSummaryCache(new Set(entries.map((entry) => entry.path)));
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, maxItems);
}

async function parseSummaryEntry(entry: SummaryFileEntry, showSubagents: boolean): Promise<AgentSession | undefined> {
  const summary = await readCachedSummary(entry);
  if (!summary) {
    return undefined;
  }

  if (isEphemeralGrokShell(summary)) {
    return undefined;
  }

  if (!showSubagents && summary.session_kind === "subagent") {
    return undefined;
  }

  const sessionDir = path.dirname(entry.path);
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

async function readCachedSummary(entry: SummaryFileEntry): Promise<GrokSummary | undefined> {
  const cached = summaryCache.get(entry.path);
  if (cached && cached.mtimeMs === entry.mtimeMs) {
    return cached.summary;
  }

  let summary: GrokSummary;
  try {
    summary = JSON.parse(await fs.readFile(entry.path, "utf8")) as GrokSummary;
  } catch {
    summaryCache.delete(entry.path);
    return undefined;
  }

  summaryCache.set(entry.path, { mtimeMs: entry.mtimeMs, summary });
  return summary;
}

function pruneSummaryCache(activePaths: Set<string>): void {
  for (const cachedPath of summaryCache.keys()) {
    if (!activePaths.has(cachedPath)) {
      summaryCache.delete(cachedPath);
    }
  }
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

async function listSummaryFileEntries(root: string): Promise<SummaryFileEntry[]> {
  const output: SummaryFileEntry[] = [];

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
        try {
          const mtimeMs = (await fs.stat(fullPath)).mtimeMs;
          output.push({ path: fullPath, mtimeMs });
        } catch {
          // Skip unreadable files.
        }
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

function isEphemeralGrokShell(summary: GrokSummary): boolean {
  const title = cleanTitle(summary.generated_title) || cleanTitle(summary.session_summary);
  const messageCount = summary.num_chat_messages ?? 0;
  return !title && messageCount <= 1;
}