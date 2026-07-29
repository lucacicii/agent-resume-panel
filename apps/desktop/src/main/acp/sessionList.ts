import type { AgentSession } from "@agent-resume/core";
import { loadAcpRecords } from "./store";
import type { AcpSessionRecord } from "./types";

export function acpRecordToAgentSession(record: AcpSessionRecord): AgentSession {
  return {
    provider: "chat",
    id: record.id,
    title: record.title,
    projectPath: record.projectPath,
    updatedAt: record.updatedAt,
    messageCount: record.messageCount,
    source: "acp",
    acpProvider: record.provider,
    model: record.provider
  };
}

export async function loadAcpAgentSessions(panelHome: string, maxItems?: number): Promise<AgentSession[]> {
  const records = await loadAcpRecords(panelHome);
  const selected = maxItems == null ? records : records.slice(0, Math.max(0, maxItems));
  return selected.map(acpRecordToAgentSession);
}

/**
 * Merge catalog sessions with ACP store sessions.
 * Keyed by provider:id (ACP uses chat:{recordId}). Prefer the fresher updatedAt.
 */
export function mergeCatalogAndAcpSessions(
  catalog: AgentSession[],
  acp: AgentSession[],
  limit?: number
): AgentSession[] {
  const byKey = new Map<string, AgentSession>();
  for (const session of catalog) {
    byKey.set(`${session.provider}:${session.id}`, session);
  }
  for (const session of acp) {
    const key = `${session.provider}:${session.id}`;
    const existing = byKey.get(key);
    if (!existing || session.updatedAt >= existing.updatedAt) {
      byKey.set(key, {
        ...existing,
        ...session,
        // Preserve acpProvider if catalog row had it and store mapping is same id
        acpProvider: session.acpProvider || existing?.acpProvider,
        source: session.source || existing?.source || "acp"
      });
    } else if (existing && !existing.acpProvider && session.acpProvider) {
      byKey.set(key, { ...existing, acpProvider: session.acpProvider, source: existing.source || "acp" });
    }
  }
  const merged = [...byKey.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  return limit == null ? merged : merged.slice(0, Math.max(0, limit));
}

/** Catalog + desktop convention: ACP chats use provider "chat" only. */
export function isAcpAgentSession(session: Pick<AgentSession, "provider" | "source" | "acpProvider">): boolean {
  return session.provider === "chat";
}
