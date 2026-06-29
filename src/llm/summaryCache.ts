import * as vscode from "vscode";
import { AgentSession } from "../history";
import { LlmOutputLanguage } from "./languages";

const CACHE_PREFIX = "agentResume.sessionSummary.";

interface CachedSummaryEntry {
  language: LlmOutputLanguage;
  summary: string;
}

function cacheKey(session: AgentSession): string {
  return `${CACHE_PREFIX}${session.provider}:${session.id}`;
}

export async function getCachedSummary(
  context: vscode.ExtensionContext,
  session: AgentSession,
  language: LlmOutputLanguage
): Promise<string | undefined> {
  const raw = context.globalState.get<CachedSummaryEntry | string>(cacheKey(session));
  if (!raw) {
    return undefined;
  }

  if (typeof raw === "string") {
    return undefined;
  }

  if (raw.language !== language) {
    return undefined;
  }

  return raw.summary?.trim() || undefined;
}

export async function setCachedSummary(
  context: vscode.ExtensionContext,
  session: AgentSession,
  language: LlmOutputLanguage,
  summary: string
): Promise<void> {
  const entry: CachedSummaryEntry = {
    language,
    summary: summary.trim()
  };
  await context.globalState.update(cacheKey(session), entry);
}