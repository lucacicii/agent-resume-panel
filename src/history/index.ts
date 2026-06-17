import { loadAlmaSessions } from "./alma";
import { loadAntigravitySessions } from "./antigravity";
import { loadClaudeSessions } from "./claude";
import { loadCodexSessions } from "./codex";
import { loadGrokSessions } from "./grok";
import { HistoryLoadOptions, HistoryLoadResult } from "./types";

export async function loadAllSessions(options: HistoryLoadOptions): Promise<HistoryLoadResult> {
  const warnings: string[] = [];
  const [codex, claude, agy, grok, alma] = await Promise.all([
    loadCodexSessions(options.codexHome, options.maxItems, options.showArchivedCodex),
    loadClaudeSessions(options.claudeHome, options.maxItems),
    loadAntigravitySessions(options.antigravityHome, options.maxItems),
    loadGrokSessions(options.grokHome, options.maxItems, options.showSubagentGrok),
    loadAlmaSessions(options.almaDataDir, options.maxItems, {
      hideCron: options.hideCronAlma,
      hideChannel: options.hideChannelAlma,
      showIncognito: options.showIncognitoAlma
    })
  ]);

  if (codex.warning) {
    warnings.push(codex.warning);
  }
  if (alma.warning) {
    warnings.push(alma.warning);
  }

  return {
    sessions: [...codex.sessions, ...claude, ...agy, ...grok, ...alma.sessions]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, options.maxItems),
    warnings
  };
}

export * from "./types";
export * from "./pathUtils";
