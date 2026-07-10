import { ensureCatalogSchema } from "../catalog/db";
import { listSessionsInRange } from "../catalog/query";
import { AgentSession } from "../catalog/types";
import { chatCompletionDetailed } from "../llm/chat";
import { llmConfigFromSettings } from "../llm/fromSettings";
import { recordLlmUsage } from "../usage/store";
import { catalogDbPath, resolvePanelHome } from "../panelHome";
import { catalogDbFromSettings, effectivePanelHome, loadSettings } from "../settings/store";
import { ensureSummariesForSessions } from "../session/ensureSummaries";
import { maybeEmbedContent, finalizeDigestEntry } from "./embedStore";
import { localDayRange as localDayRangeImpl } from "./period";
import { DigestProgressCallback } from "./progress";
import {
  buildDailySystemPrompt,
  buildDailyUserPrompt,
  formatSessionForDigest,
  normalizeDigestMarkdown
} from "./prompts";
import { MemoryEntry } from "./schema";
import { getMemoryEntryById, listMemoryLinks, upsertMemoryJob } from "./store";

export interface RunDailyDigestOptions {
  /** Override panel home (default from settings / ~/.agent-resume-panel). */
  panelHome?: string;
  /** Local calendar date YYYY-MM-DD; default today. */
  date?: string;
  /** Skip embedding even if configured. */
  skipEmbedding?: boolean;
  /** @deprecated Daily generation always reuses existing session summaries. */
  forceResummarize?: boolean;
  /** Progress for Desktop UI. */
  onProgress?: DigestProgressCallback;
  /**
   * @deprecated Transcript snippets are no longer used; digests extract from session summaries.
   * Kept for API compatibility; ignored.
   */
  includeTranscripts?: boolean;
}

export interface RunDailyDigestResult {
  entry: MemoryEntry;
  sessionCount: number;
  /** Sessions that have a non-empty session_summary after ensure step. */
  summaryReadyCount: number;
  /** Newly summarized in this run. */
  summarizedCount: number;
  /** Already had summary and were skipped. */
  summarySkippedCount: number;
  /** Per-session summarize failures (digest still runs). */
  summaryFailed: Array<{ key: string; error: string }>;
  /**
   * @deprecated Alias of summaryReadyCount for older callers.
   */
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

export type DailyDigestRefreshReason =
  | "missing"
  | "no_sessions"
  | "new_sessions"
  | "updated_sessions"
  | "up_to_date";

export interface DailyDigestRefreshCheck {
  needed: boolean;
  reason: DailyDigestRefreshReason;
  sessionCount: number;
  /** Sessions not linked on the existing daily digest. */
  newSessionCount: number;
  /** Sessions with updatedAt after the daily was written. */
  updatedSessionCount: number;
  digestCreatedAtMs?: number;
  message: string;
}

/**
 * Decide whether auto-click should regenerate the daily digest for a local day.
 * Uses catalog session set + updated_at_ms vs digest created_at + memory_links.
 */
export async function needsDailyDigestRefresh(
  options: { panelHome?: string; date?: string } = {}
): Promise<DailyDigestRefreshCheck> {
  const settings = await loadSettings(options.panelHome);
  const panelHome = options.panelHome
    ? resolvePanelHome(options.panelHome)
    : effectivePanelHome(settings, options.panelHome);
  const dbPath = options.panelHome
    ? catalogDbPath(panelHome)
    : catalogDbFromSettings(settings, options.panelHome);

  await ensureCatalogSchema(dbPath);

  const period = localDayRangeImpl(options.date);
  const sessions = await listSessionsInRange(dbPath, period.startMs, period.endMs);
  const sessionCount = sessions.length;
  const entry = await getMemoryEntryById(dbPath, period.entryId);

  if (!entry?.content?.trim()) {
    if (!sessionCount) {
      return {
        needed: false,
        reason: "no_sessions",
        sessionCount: 0,
        newSessionCount: 0,
        updatedSessionCount: 0,
        message: "当日无 session，跳过生成"
      };
    }
    return {
      needed: true,
      reason: "missing",
      sessionCount,
      newSessionCount: sessionCount,
      updatedSessionCount: 0,
      message: `尚无日报 · ${sessionCount} sessions，将生成`
    };
  }

  const links = await listMemoryLinks(dbPath, entry.id);
  const linked = new Set(
    links
      .filter((l) => l.provider && l.agentSessionId)
      .map((l) => `${l.provider}:${l.agentSessionId}`)
  );

  let newSessionCount = 0;
  let updatedSessionCount = 0;
  for (const s of sessions) {
    const key = `${s.provider}:${s.id}`;
    if (!linked.has(key)) {
      newSessionCount += 1;
    }
    if (s.updatedAt > entry.createdAtMs) {
      updatedSessionCount += 1;
    }
  }

  if (newSessionCount > 0) {
    return {
      needed: true,
      reason: "new_sessions",
      sessionCount,
      newSessionCount,
      updatedSessionCount,
      digestCreatedAtMs: entry.createdAtMs,
      message: `检测到 ${newSessionCount} 个新 session，将重新生成日报`
    };
  }
  if (updatedSessionCount > 0) {
    return {
      needed: true,
      reason: "updated_sessions",
      sessionCount,
      newSessionCount: 0,
      updatedSessionCount,
      digestCreatedAtMs: entry.createdAtMs,
      message: `检测到 ${updatedSessionCount} 个 session 有更新，将重新生成日报`
    };
  }

  return {
    needed: false,
    reason: "up_to_date",
    sessionCount,
    newSessionCount: 0,
    updatedSessionCount: 0,
    digestCreatedAtMs: entry.createdAtMs,
    message: `日报已是最新（${sessionCount} sessions）`
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
  const onProgress = options.onProgress;
  await upsertMemoryJob(dbPath, jobKey, "running");

  try {
    onProgress?.({
      phase: "start",
      level: "daily",
      periodLabel: dateLabel,
      message: `生成日报 ${dateLabel}…（先 summarize sessions）`
    });

    const llm = llmConfigFromSettings(settings);
    if (!llm) {
      throw new Error(
        "LLM is not configured. Set llm.baseUrl, llm.model, and llm.apiKey in ~/.agent-resume-panel/settings.json"
      );
    }

    const maxSessions = Math.max(1, Math.min(settings.memory?.maxSessionsPerDigest ?? 40, 200));

    let sessions = await listSessionsInRange(dbPath, startMs, endMs);
    const totalFound = sessions.length;
    if (sessions.length > maxSessions) {
      sessions = sessions.slice(0, maxSessions);
    }

    const ensure = await ensureSummariesForSessions({
      dbPath,
      sessions,
      settings,
      panelHome,
      // Daily digests never regenerate an existing session summary. The option
      // remains accepted for API compatibility with older callers.
      force: false,
      jobKeyPrefix: `summarize:${jobKey}`,
      onProgress,
      progressLevel: "daily",
      progressPeriodLabel: dateLabel
    });
    sessions = ensure.sessions;

    const lines: string[] = [];
    let summaryReadyCount = 0;
    for (const session of sessions) {
      const summary = session.sessionSummary?.trim();
      if (summary) {
        summaryReadyCount += 1;
      }
      lines.push(
        formatSessionForDigest({
          provider: session.provider,
          title: session.title,
          projectPath: session.projectPath,
          summary: session.sessionSummary,
          updatedAt: session.updatedAt
        })
      );
    }

    if (totalFound > maxSessions) {
      lines.push(
        `(Note: ${totalFound - maxSessions} additional sessions on this day were omitted due to maxSessionsPerDigest=${maxSessions}.)`
      );
    }

    onProgress?.({
      phase: "digest",
      level: "daily",
      periodLabel: dateLabel,
      message: `从 summary 提取日报 ${dateLabel}…`
    });

    const language = llm.outputLanguage || "zh-CN";
    const chatResult = await chatCompletionDetailed(
      llm,
      [
        { role: "system", content: buildDailySystemPrompt(language) },
        { role: "user", content: buildDailyUserPrompt(dateLabel, lines, language) }
      ],
      2000
    );
    const content = normalizeDigestMarkdown(chatResult.content);
    await recordLlmUsage(dbPath, {
      kind: "chat",
      source: "daily",
      jobKey,
      model: chatResult.model,
      usage: chatResult.usage,
      durationMs: chatResult.durationMs,
      ok: true
    });

    onProgress?.({
      phase: "embed",
      level: "daily",
      periodLabel: dateLabel,
      message: options.skipEmbedding ? "跳过 embedding…" : "写入 embedding…"
    });

    const embedResult = await maybeEmbedContent(settings, content, options.skipEmbedding);
    const { embeddingJson, embedded } = embedResult;
    if (embedded) {
      await recordLlmUsage(dbPath, {
        kind: "embedding",
        source: "daily",
        jobKey,
        model: embedResult.model,
        usage: embedResult.usage,
        durationMs: embedResult.durationMs,
        ok: true
      });
    }

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

    onProgress?.({
      phase: "complete",
      level: "daily",
      periodLabel: dateLabel,
      message: `日报完成 · ${sessions.length} sessions`
    });

    return {
      entry,
      sessionCount: sessions.length,
      summaryReadyCount,
      summarizedCount: ensure.summarized,
      summarySkippedCount: ensure.skipped,
      summaryFailed: ensure.failed,
      snippetCount: summaryReadyCount,
      jobKey,
      embedded,
      replaced
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await upsertMemoryJob(dbPath, jobKey, "error", message);
    onProgress?.({
      phase: "error",
      level: "daily",
      periodLabel: dateLabel,
      message
    });
    throw error;
  }
}
