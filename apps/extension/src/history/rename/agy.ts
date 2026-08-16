import * as fs from "node:fs/promises";
import * as path from "node:path";
import { AgentSession } from "../types";
import { appendJsonLine, isNodeError, readJsonLines } from "../jsonl";

interface AntigravityHistoryRow {
  display?: string;
  timestamp?: number;
  workspace?: string;
  conversationId?: string;
}

export async function renameAgySession(
  antigravityHome: string,
  session: AgentSession,
  title: string
): Promise<void> {
  if (session.source === "brain") {
    const taskPath = await findBrainTaskPath(antigravityHome, session.id);
    if (!taskPath) {
      throw new Error(`Antigravity task.md not found for session ${session.id}.`);
    }
    await updateTaskTitle(taskPath, title);
    return;
  }

  const root = await findAgyRoot(antigravityHome, session);
  if (!root) {
    throw new Error(`Antigravity data root not found for session ${session.id}.`);
  }

  await appendJsonLine(path.join(root, "history.jsonl"), {
    display: title,
    timestamp: Date.now(),
    workspace: session.projectPath,
    conversationId: session.id
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

async function findAgyRoot(antigravityHome: string, session: AgentSession): Promise<string | undefined> {
  for (const root of candidateRoots(antigravityHome)) {
    const rows = await readJsonLines<AntigravityHistoryRow>(path.join(root, "history.jsonl"));
    if (rows.some((row) => row.conversationId === session.id)) {
      return root;
    }
  }

  for (const root of candidateRoots(antigravityHome)) {
    try {
      await fs.access(path.join(root, "history.jsonl"));
      return root;
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  return candidateRoots(antigravityHome)[0];
}

async function findBrainTaskPath(antigravityHome: string, sessionId: string): Promise<string | undefined> {
  for (const root of candidateRoots(antigravityHome)) {
    const taskPath = path.join(root, "brain", sessionId, "task.md");
    try {
      await fs.access(taskPath);
      return taskPath;
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  return undefined;
}

async function updateTaskTitle(taskPath: string, title: string): Promise<void> {
  const raw = await fs.readFile(taskPath, "utf8");
  const lines = raw.split(/\r?\n/);
  let replaced = false;

  const nextLines = lines.map((line) => {
    if (!replaced && /^#+\s*/.test(line)) {
      replaced = true;
      return `# ${title}`;
    }
    return line;
  });

  if (!replaced) {
    nextLines.unshift(`# ${title}`, "");
  }

  await fs.writeFile(taskPath, `${nextLines.join("\n")}\n`, "utf8");
}