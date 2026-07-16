import { getAcpRecord, updateAcpRecord } from "../../acp/store";
import { AgentSession } from "../types";

export async function renameAcpSession(panelHome: string, session: AgentSession, title: string): Promise<void> {
  const record = await getAcpRecord(panelHome, session.id);
  if (!record) {
    throw new Error("ACP chat session not found.");
  }

  record.title = title;
  record.updatedAt = Date.now();
  await updateAcpRecord(panelHome, record);
}