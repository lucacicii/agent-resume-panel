import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AgentSession } from "../types";

const execFileAsync = promisify(execFile);

export async function runGrokSessionDelete(sessionId: string): Promise<void> {
  await execFileAsync("grok", ["sessions", "delete", sessionId], { maxBuffer: 1024 * 1024 });
}

export async function runOpenCodeSessionDelete(sessionId: string): Promise<void> {
  await execFileAsync("opencode", ["session", "delete", sessionId], { maxBuffer: 1024 * 1024 });
}

export async function runCodexArchive(session: AgentSession): Promise<void> {
  await execFileAsync("codex", ["archive", session.id], {
    maxBuffer: 1024 * 1024,
    cwd: session.projectPath || undefined
  });
}