import { ensureCatalogSchema } from "../catalog/db";
import { listSessionsInRange } from "../catalog/query";
import { AgentSession } from "../catalog/types";
import { chatCompletion } from "../llm/chat";
import { llmConfigFromSettings } from "../llm/fromSettings";
import { catalogDbPath, resolvePanelHome } from "../panelHome";
import { catalogDbFromSettings, effectivePanelHome, loadSettings } from "../settings/store";
import { resolvePreviewHomes } from "../transcript/homes";
import { loadSessionSnippet } from "../transcript/load";
import { maybeEmbedContent, finalizeDigestEntry } from "./embedStore";
import { localDayRange as localDayRangeImpl } from "./period";
import { buildDailySystemPrompt, buildDailyUserPrompt, formatSessionForDigest } from "./prompts";
import { MemoryEntry } from "./schema";
import { upsertMemoryJob } from "./store";

export interface RunDailyDigestOptions {
  /** Override panel home (default from settings / ~/.agent-resume-panel). */
  panelHome?: string;
  /** Local calendar date YYYY-MM-DD; default today. */
  date?: string;
  /** Skip embedding even if configured. */
  skipEmbedding?: boolean;
  /** Override settings.memory.includeTranscripts. */
  includeTranscripts?: boolean;
}

export interface RunDailyDigestResult {
  entry: MemoryEntry;
  sessionCount: number;
  /** Sessions that contributed a transcript excerpt (not only title/summary). */
  snippetCount: number;
  jobKey: string;
  embedded: boolean;
  /** True when an existing same-day entry was replaced. */
  replaced: boolean;
}

/** @deprecated Prefer importing from period.ts; kept for API compatibility. */
export function localDayRange(dateStr?: string): {
  startMs: number;
  endMs: number;
  dateLabel: string;
  jobKey: string;
  entryId: string;
} {
  const p = localDayRangeImpl(dateStr);
  return {
    startMs: p.startMs,
    endMs: p.endMs,
    dateLabel: p.label,
    jobKey: p.jobKey,
    entryId: p.entryId
  };
}

export async function runDailyDigest(options: RunDailyDigestOptions = {}): Promise<RunDailyDigestResult> {
  const settings = await loadSettings(options.panelHome);
  const panelHome = options.panelHome
    ? resolvePanelHome(options.panelHome)
    : effectivePanelHome(settings, options.panelHome);
  const dbPath = options.panelHome
    ? catalogDbPath(panelHome)
    : catalogDbFromSettings(settings, options.panelHome);

  await ensureCatalogSchema(dbPath);

  const period = localDayRangeImpl(options.date);
  const { startMs, endMs, label: dateLabel, jobKey, entryId } = period;
  await upsertMemoryJob(dbPath, jobKey, "running");

  try {
    const llm = llmConfigFromSettings(settings);
    if (!llm) {
      throw new Error(
        "LLM is not configured. Set llm.baseUrl, llm.model, and llm.apiKey in ~/.agent-resume-panel/settings.json"
      );
    }

    const maxSessions = Math.max(1, Math.min(settings.memory?.maxSessionsPerDigest ?? 40, 200));
    const includeTranscripts =
      options.includeTranscripts ?? settings.memory?.includeTranscripts ?? true;
    const snippetMaxChars = Math.max(400, Math.min(settings.memory?.snippetMaxChars ?? 2500, 12_000));

    let sessions = await listSessionsInRange(dbPath, startMs, endMs);
    const totalFound = sessions.length;
    if (sessions.length > maxSessions) {
      sessions = sessions.slice(0, maxSessions);
    }

    const homes = resolvePreviewHomes(settings, panelHome);
    let snippetCount = 0;

    const lines: string[] = [];
    for (const session of sessions) {
      let transcriptSnippet: string | undefined;
      if (includeTranscripts && !session.sessionSummary?.trim()) {
        const snippet = await loadSessionSnippet(session, homes, snippetMaxChars);
        if (snippet) {
          transcriptSnippet = snippet;
          snippetCount += 1;
        }
      } else if (includeTranscripts && session.sessionSummary?.trim()) {
        if (session.sessionSummary.trim().length < 80) {
          const snippet = await loadSessionSnippet(session, homes, Math.min(snippetMaxChars, 1200));
          if (snippet) {
            transcriptSnippet = snippet;
            snippetCount += 1;
          }
        }
      }

      lines.push(
        formatSessionForDigest({
          provider: session.provider,
          title: session.title,
          projectPath: session.projectPath,
          summary: session.sessionSummary,
          transcriptSnippet,
          updatedAt: session.updatedAt
        })
      );
    }

    if (totalFound > maxSessions) {
      lines.push(
        `(Note: ${totalFound - maxSessions} additional sessions on this day were omitted due to maxSessionsPerDigest=${maxSessions}.)`
      );
    }

    const language = llm.outputLanguage || "zh-CN";
    const content = await chatCompletion(
      llm,
      [
        { role: "system", content: buildDailySystemPrompt(language) },
        { role: "user", content: buildDailyUserPrompt(dateLabel, lines) }
      ],
      2000
    );

    const { embeddingJson, embedded } = await maybeEmbedContent(
      settings,
      content,
      options.skipEmbedding
    );

    const entry: MemoryEntry = {
      id: entryId,
      level: "daily",
      periodStartMs: startMs,
      periodEndMs: endMs,
      title: `Daily · ${dateLabel}`,
      content,
      embeddingJson,
      createdAtMs: Date.now()
    };

    const { replaced } = await finalizeDigestEntry(
      dbPath,
      entry,
      sessions.map((s: AgentSession) => ({
        provider: s.provider,
        agentSessionId: s.id,
        projectPath: s.projectPath
      })),
      jobKey
    );

    return {
      entry,
      sessionCount: sessions.length,
      snippetCount,
      jobKey,
      embedded,
      replaced
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await upsertMemoryJob(dbPath, jobKey, "error", message);
    throw error;
  }
}
