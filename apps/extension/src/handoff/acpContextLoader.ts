import { expandHome } from "../history/pathUtils";
import * as vscode from "vscode";
import { loadAcpMessages } from "../acp/store";
import { AcpSessionRecord } from "../acp/types";
import { PreviewMessage } from "../history/preview/types";
import { HandoffSessionContext } from "./types";

const MAX_ACP_HANDOFF_MESSAGES = 100;

export async function loadAcpHandoffContext(
  record: AcpSessionRecord,
  panelHome?: string
): Promise<HandoffSessionContext> {
  const home =
    panelHome ??
    expandHome(vscode.workspace.getConfiguration("agentResume").get<string>("panelHome", "~/.agent-resume-panel"));

  const rows = await loadAcpMessages(home, record.id);
  const messages: PreviewMessage[] = [];

  for (const row of rows) {
    if (row.role !== "user" && row.role !== "assistant") {
      continue;
    }

    const text = row.text.trim();
    if (!text) {
      continue;
    }

    messages.push({
      role: row.role,
      text,
      timestamp: new Date(row.timestamp).toISOString()
    });
  }

  if (!messages.length) {
    throw new Error("ACP chat has no messages to hand off.");
  }

  const truncated = messages.length > MAX_ACP_HANDOFF_MESSAGES;
  const selected = truncated ? messages.slice(-MAX_ACP_HANDOFF_MESSAGES) : messages;

  return {
    sourceKind: "acp",
    sourceProvider: record.provider,
    sessionId: record.id,
    title: record.title,
    projectPath: record.projectPath,
    messages: selected,
    truncated,
    truncationWarning: truncated
      ? `ACP chat handoff includes only the most recent ${MAX_ACP_HANDOFF_MESSAGES} messages.`
      : undefined
  };
}