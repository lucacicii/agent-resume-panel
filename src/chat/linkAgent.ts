import * as path from "node:path";
import { AgentSession } from "../history";
import { queueChatAgentLink } from "./pendingLinks";
import { getChatRecord, updateChatRecord } from "./store";
import { ChatSessionRecord } from "./types";

export async function tryLinkChatAgent(
  panelHome: string,
  chatId: string,
  sessions: AgentSession[],
  linkedAgentKeys: Set<string>
): Promise<ChatSessionRecord | undefined> {
  const record = await getChatRecord(panelHome, chatId);
  if (!record || record.linkedAgent.sessionId || !record.linkedAgent.linkedAt) {
    return record;
  }

  const projectPath = path.resolve(record.projectPath);
  const linkedAt = record.linkedAgent.linkedAt;
  const provider = record.linkedAgent.provider;

  const candidates = sessions
    .filter((session) => session.provider === provider)
    .filter((session) => path.resolve(session.projectPath || "") === projectPath)
    .filter((session) => session.updatedAt >= linkedAt - 5000)
    .filter((session) => !linkedAgentKeys.has(`${session.provider}:${session.id}`))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const matched = candidates[0];
  if (!matched) {
    return record;
  }

  record.linkedAgent.sessionId = matched.id;
  record.updatedAt = Date.now();
  await updateChatRecord(panelHome, record);
  return record;
}

export function scheduleChatAgentLink(chatId: string, reload: () => Promise<void>): void {
  queueChatAgentLink(chatId);
  setTimeout(() => {
    void reload();
  }, 5000);
}