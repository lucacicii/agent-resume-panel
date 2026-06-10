import { loadAntigravitySessions } from "./antigravity";
import { loadClaudeSessions } from "./claude";
import { loadCodexSessions } from "./codex";
import { HistoryLoadOptions, HistoryLoadResult } from "./types";

export async function loadAllSessions(options: HistoryLoadOptions): Promise<HistoryLoadResult> {
  const warnings: string[] = [];
  const [codex, claude, agy] = await Promise.all([
    loadCodexSessions(options.codexHome, options.maxItems, options.showArchivedCodex),
    loadClaudeSessions(options.claudeHome, options.maxItems),
    loadAntigravitySessions(options.antigravityHome, options.maxItems)
  ]);

  if (codex.warning) {
    warnings.push(codex.warning);
  }

  return {
    sessions: [...codex.sessions, ...claude, ...agy]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, options.maxItems),
    warnings
  };
}

export * from "./types";
export * from "./pathUtils";
