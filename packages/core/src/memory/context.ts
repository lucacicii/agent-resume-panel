import { listSessionsInRange } from "../catalog/query";
import { formatSessionForDigest } from "./prompts";
import { MemoryEntry, MemoryLevel } from "./schema";
import { listMemoryEntriesInRange } from "./store";

export async function buildWeeklySourceLines(
  dbPath: string,
  startMs: number,
  endMs: number,
  maxSessions = 40
): Promise<{ lines: string[]; sourceCount: number; usedDailies: number }> {
  const dailies = await listMemoryEntriesInRange(dbPath, {
    level: "daily",
    startMs,
    endMs,
    limit: 14
  });

  if (dailies.length) {
    const lines = dailies.map(
      (e, i) =>
        `Daily ${i + 1}: ${e.title || e.id}\n${truncate(e.content, 4000)}`
    );
    return { lines, sourceCount: dailies.length, usedDailies: dailies.length };
  }

  const sessions = await listSessionsInRange(dbPath, startMs, endMs, maxSessions);
  const lines = sessions.map((s) =>
    formatSessionForDigest({
      provider: s.provider,
      title: s.title,
      projectPath: s.projectPath,
      summary: s.sessionSummary,
      updatedAt: s.updatedAt
    })
  );
  return { lines, sourceCount: sessions.length, usedDailies: 0 };
}

export async function buildMonthlySourceLines(
  dbPath: string,
  startMs: number,
  endMs: number,
  maxSessions = 40
): Promise<{ lines: string[]; sourceCount: number; usedWeeklies: number; usedDailies: number }> {
  const weeklies = await listMemoryEntriesInRange(dbPath, {
    level: "weekly",
    startMs,
    endMs,
    limit: 8
  });

  if (weeklies.length) {
    const lines = weeklies.map(
      (e, i) => `Weekly ${i + 1}: ${e.title || e.id}\n${truncate(e.content, 5000)}`
    );
    return { lines, sourceCount: weeklies.length, usedWeeklies: weeklies.length, usedDailies: 0 };
  }

  const dailies = await listMemoryEntriesInRange(dbPath, {
    level: "daily",
    startMs,
    endMs,
    limit: 40
  });

  if (dailies.length) {
    const lines = dailies.map(
      (e, i) => `Daily ${i + 1}: ${e.title || e.id}\n${truncate(e.content, 2500)}`
    );
    return { lines, sourceCount: dailies.length, usedWeeklies: 0, usedDailies: dailies.length };
  }

  const sessions = await listSessionsInRange(dbPath, startMs, endMs, maxSessions);
  const lines = sessions.map((s) =>
    formatSessionForDigest({
      provider: s.provider,
      title: s.title,
      projectPath: s.projectPath,
      summary: s.sessionSummary,
      updatedAt: s.updatedAt
    })
  );
  return { lines, sourceCount: sessions.length, usedWeeklies: 0, usedDailies: 0 };
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}\n[...truncated...]`;
}

export type { MemoryEntry, MemoryLevel };
