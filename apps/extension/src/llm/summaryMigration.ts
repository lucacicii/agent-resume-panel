import * as vscode from "vscode";
import { loadCatalogSettings } from "../catalog/config";
import { ensureCatalogSchema } from "../catalog/db";
import { setSessionSummaryInCatalog } from "../catalog/mutations";
import { AgentProvider } from "../history";
import { LlmOutputLanguage, normalizeOutputLanguage } from "./languages";

const MIGRATION_FLAG = "agentResume.sessionSummaryMigratedToCatalog";
const LEGACY_CACHE_PREFIX = "agentResume.sessionSummary.";

interface LegacyCachedSummaryEntry {
  language: LlmOutputLanguage;
  summary: string;
}

const SUPPORTED_PROVIDERS = new Set<AgentProvider>([
  "codex",
  "claude",
  "agy",
  "grok",

  "opencode",
  "pi",
  "prime",
  "chat"
]);

export async function migrateSummariesFromGlobalState(context: vscode.ExtensionContext): Promise<void> {
  if (context.globalState.get<boolean>(MIGRATION_FLAG)) {
    return;
  }

  const catalog = loadCatalogSettings();
  await ensureCatalogSchema(catalog.dbPath);

  const legacyKeys = context.globalState.keys().filter((key) => key.startsWith(LEGACY_CACHE_PREFIX));
  for (const key of legacyKeys) {
    const raw = context.globalState.get<LegacyCachedSummaryEntry | string>(key);
    if (!raw || typeof raw === "string") {
      await context.globalState.update(key, undefined);
      continue;
    }

    const summary = raw.summary?.trim();
    if (!summary) {
      await context.globalState.update(key, undefined);
      continue;
    }

    const sessionKey = key.slice(LEGACY_CACHE_PREFIX.length);
    const separatorIndex = sessionKey.indexOf(":");
    if (separatorIndex < 0) {
      await context.globalState.update(key, undefined);
      continue;
    }

    const provider = sessionKey.slice(0, separatorIndex) as AgentProvider;
    const sessionId = sessionKey.slice(separatorIndex + 1);
    if (!SUPPORTED_PROVIDERS.has(provider) || !sessionId) {
      await context.globalState.update(key, undefined);
      continue;
    }

    const language = normalizeOutputLanguage(raw.language);
    try {
      await setSessionSummaryInCatalog(catalog.dbPath, provider, sessionId, language, summary);
    } catch {
      continue;
    }

    await context.globalState.update(key, undefined);
  }

  await context.globalState.update(MIGRATION_FLAG, true);
}
