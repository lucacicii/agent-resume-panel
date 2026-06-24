import { loadChatRecords } from "../chat/store";
import { AgentSession } from "./types";

export async function loadChatSessions(panelHome: string, maxItems: number): Promise<AgentSession[]> {
  const records = await loadChatRecords(panelHome);
  return records.slice(0, maxItems).map((record) => ({
    provider: "chat" as const,
    id: record.id,
    title: record.title,
    projectPath: record.projectPath,
    updatedAt: record.updatedAt,
    model: record.model,
    messageCount: record.messageCount,
    source: "panel",
    chatLink: {
      chatId: record.id,
      provider: record.linkedAgent.provider,
      sessionId: record.linkedAgent.sessionId,
      handoffCount: record.linkedAgent.handoffCount,
      lastAgentSummaryAt: record.lastAgentSummaryAt
    }
  }));
}

export function collectLinkedAgentKeys(sessions: AgentSession[]): Set<string> {
  const keys = new Set<string>();
  for (const session of sessions) {
    if (session.provider === "chat" && session.chatLink?.sessionId) {
      keys.add(`${session.chatLink.provider}:${session.chatLink.sessionId}`);
    }
  }
  return keys;
}