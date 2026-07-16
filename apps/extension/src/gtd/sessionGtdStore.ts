import { ensureCatalogSchema } from "../catalog/db";
import {
  clearSessionGtdStatus,
  GtdStatus,
  loadSessionGtdMap,
  sessionGtdKey,
  setSessionGtdStatus
} from "../catalog/gtd";
import { AgentSession } from "../history/types";

export class SessionGtdStore {
  private map: Record<string, GtdStatus> = {};

  constructor(private readonly dbPath: string) {}

  async initialize(): Promise<void> {
    await ensureCatalogSchema(this.dbPath);
    await this.reload();
  }

  async reload(): Promise<void> {
    this.map = await loadSessionGtdMap(this.dbPath);
  }

  get(session: Pick<AgentSession, "provider" | "id">): GtdStatus | undefined {
    return this.map[sessionGtdKey(session)];
  }

  async set(session: Pick<AgentSession, "provider" | "id">, status: GtdStatus): Promise<void> {
    await setSessionGtdStatus(this.dbPath, session, status);
    this.map[sessionGtdKey(session)] = status;
  }

  async clear(session: Pick<AgentSession, "provider" | "id">): Promise<void> {
    await clearSessionGtdStatus(this.dbPath, session);
    delete this.map[sessionGtdKey(session)];
  }

  countByStatus(sessions: AgentSession[]): Record<GtdStatus, number> {
    const counts = Object.fromEntries(
      (["inbox", "next", "waiting", "someday", "reference"] as const).map((status) => [status, 0])
    ) as Record<GtdStatus, number>;

    for (const session of sessions) {
      const status = this.get(session);
      if (status) {
        counts[status] += 1;
      }
    }

    return counts;
  }

  sessionsForStatus(sessions: AgentSession[], status: GtdStatus): AgentSession[] {
    return sessions
      .filter((session) => this.get(session) === status)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }
}