import * as vscode from "vscode";
import { AgentSession } from "../history";
import { syncAgentSummaryIfNeeded } from "./agentSummary";
import { ChatPanelManager } from "./chatPanel";

const activePolls = new Map<string, NodeJS.Timeout>();
const POLL_DURATION_MS = 5 * 60 * 1000;

export function startWatchingSummary(
  context: vscode.ExtensionContext,
  panelHome: string,
  chatId: string,
  loadSessions: () => Promise<AgentSession[]>,
  chatPanels: ChatPanelManager
): void {
  stopWatchingSummary(chatId);

  const intervalMs = vscode.workspace
    .getConfiguration("agentResume")
    .get<number>("chatSummaryPollIntervalMs", 15000);

  const startedAt = Date.now();
  const timer = setInterval(() => {
    void (async () => {
      if (Date.now() - startedAt > POLL_DURATION_MS) {
        stopWatchingSummary(chatId);
        return;
      }

      const sessions = await loadSessions();
      const message = await syncAgentSummaryIfNeeded(context, panelHome, chatId, sessions);
      if (message) {
        chatPanels.appendSummary(chatId, message);
        stopWatchingSummary(chatId);
      }
    })();
  }, intervalMs);

  activePolls.set(chatId, timer);
}

export function stopWatchingSummary(chatId: string): void {
  const timer = activePolls.get(chatId);
  if (timer) {
    clearInterval(timer);
    activePolls.delete(chatId);
  }
}

export function stopAllWatchers(): void {
  for (const chatId of activePolls.keys()) {
    stopWatchingSummary(chatId);
  }
}