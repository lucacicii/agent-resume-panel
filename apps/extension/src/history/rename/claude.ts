import * as path from "node:path";
import { AgentSession } from "../types";
import { appendJsonLine } from "../jsonl";
import { preservedTimestampMs } from "./preserveTimes";

export async function renameClaudeSession(claudeHome: string, session: AgentSession, title: string): Promise<void> {
  const historyPath = path.join(claudeHome, "history.jsonl");
  await appendJsonLine(historyPath, {
    display: title,
    timestamp: preservedTimestampMs(session.updatedAt),
    project: session.nativeProjectPath || session.projectPath,
    sessionId: session.id
  });
}