import * as path from "node:path";
import { AgentSession } from "../types";
import { appendJsonLine } from "../jsonl";

export async function renameClaudeSession(claudeHome: string, session: AgentSession, title: string): Promise<void> {
  const historyPath = path.join(claudeHome, "history.jsonl");
  await appendJsonLine(historyPath, {
    display: title,
    timestamp: Date.now(),
    project: session.projectPath,
    sessionId: session.id
  });
}