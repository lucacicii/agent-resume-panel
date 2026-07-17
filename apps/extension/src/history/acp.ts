import { loadAcpRecords } from "../acp/store";
import { AcpAgentProvider } from "../acp/types";
import { AgentSession } from "./types";

export async function loadAcpSessions(panelHome: string, maxItems: number): Promise<AgentSession[]> {
  const records = await loadAcpRecords(panelHome);
  return records.slice(0, maxItems).map((record) => ({
    provider: "chat" as const,
    id: record.id,
    title: record.title,
    projectPath: record.projectPath,
    updatedAt: record.updatedAt,
    messageCount: record.messageCount,
    source: "acp",
    acpProvider: record.provider as AcpAgentProvider,
    model: record.provider
  }));
}