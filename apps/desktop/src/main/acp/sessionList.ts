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
 * Hide Codex's native catalog row when the same thread is owned by an ACP chat.
 * This is a read-time guard for the short window before the shared catalog sync
 * removes the duplicate row permanently.
 */
export function excludeCodexAcpNativeSessions(
  catalog: AgentSession[],
  records: AcpSessionRecord[]
): AgentSession[] {
  const nativeCodexIds = new Set(
    records
      .filter((record) => record.provider === "codex")
      .map((record) => record.acpSessionId?.trim())
      .filter((sessionId): sessionId is string => Boolean(sessionId))
  );
  if (!nativeCodexIds.size) return catalog;
  return catalog.filter((session) => session.provider !== "codex" || !nativeCodexIds.has(session.id));
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
      const merged = {
        ...existing,
        ...session,
        // Preserve acpProvider if catalog row had it and store mapping is same id
        acpProvider: session.acpProvider || existing?.acpProvider,
        source: session.source || existing?.source || "acp"
      };
      // A user-moved chat (projectOverridden) must keep the catalog's effective
      // project path even when the ACP store (possibly rewritten by another
      // product) carries the original path and a fresher timestamp.
      if (existing?.projectOverridden) {
        merged.projectPath = existing.projectPath;
        merged.projectOverridden = true;
        merged.nativeProjectPath = session.nativeProjectPath || existing.nativeProjectPath;
      }
      byKey.set(key, merged);
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
