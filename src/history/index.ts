import { loadClaudeSessions } from "./claude";
import { loadCodexSessions } from "./codex";
import { HistoryLoadOptions, HistoryLoadResult } from "./types";

export async function loadAllSessions(options: HistoryLoadOptions): Promise<HistoryLoadResult> {
  const warnings: string[] = [];
  const [codex, claude] = await Promise.all([
    loadCodexSessions(options.codexHome, options.maxItems, options.showArchivedCodex),
    loadClaudeSessions(options.claudeHome, options.maxItems)
  ]);

  if (codex.warning) {
    warnings.push(codex.warning);
  }

  return {
    sessions: [...codex.sessions, ...claude]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, options.maxItems),
    warnings
  };
}

export * from "./types";
export * from "./pathUtils";
