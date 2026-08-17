import { setSessionSummaryInCatalog } from "../catalog/mutations";
import { AgentSession } from "../catalog/types";
import { preparePanelDatabasesFromSettings } from "../dbPaths";
import { DigestProgressCallback, sessionProgressRef } from "../report/progress";
import { DEFAULT_CATALOG_OUTPUT_LANGUAGE } from "../i18n/outputLanguage";
import { createReportProgressText } from "../report/progressI18n";
import { llmConfigFromSettings } from "../llm/fromSettings";
import { LlmRuntimeConfig } from "../llm/types";
import { PanelSettings } from "../settings/types";
import { resolvePreviewHomes } from "../transcript/homes";
import { loadSessionPreview } from "../transcript/load";
import { PreviewHomes } from "../transcript/types";
import { recordLlmUsage } from "../usage/store";
import { summarizeSessionMessages } from "./assist";
import { upsertSessionEmbedding } from "./embedStore";
import { indexSessionTranscript } from "./transcriptIndex";

export interface EnsureSummariesOptions {
  dbPath: string;
  sessions: AgentSession[];
  settings: PanelSettings;
  /** Re-run summarize even when session_summary already exists. Default false. */
  force?: boolean;
  /**
   * When true, re-summarize if a summary exists but session.updatedAt is newer than
   * sessionSummaryAtMs (or summary_at is missing). Ignored when force=true.
   * Default false (digest path keeps existing summaries).
   */
  refreshIfStale?: boolean;
  /** Parallel LLM calls. Default 2. */
  concurrency?: number;
  /** Optional panel home hint for agent homes resolution. */
  panelHome?: string;
  /** Prefix for usage job keys. */
  jobKeyPrefix?: string;
  /** Progress for UI (session-level). */
  onProgress?: DigestProgressCallback;
  /** OS / VS Code display locale when output language is auto. */
  systemLocale?: string;
  /**
   * Whether to enqueue derived embedding/transcript indexes after a summary.
   * Auto-summary has dedicated background workers for these indexes, so it
   * disables the side effects to avoid duplicate work.
   */
  indexDerivedData?: boolean;
  progressLevel?: "daily" | "weekly" | "monthly";
  progressPeriodLabel?: string;
}

export interface EnsureSummariesResult {
  /** Sessions with updated in-memory sessionSummary where available. */
  sessions: AgentSession[];
  summarized: number;
  skipped: number;
  failed: Array<{ key: string; error: string }>;
}

/**
 * Ensure each session has a catalog-backed session_summary (same pipeline as UI Summarize).
 * Existing non-empty summaries are skipped unless force=true.
 * Per-session failures are collected; callers should still continue to digest generation.
 */
export async function ensureSummariesForSessions(
  options: EnsureSummariesOptions
): Promise<EnsureSummariesResult> {
  const llmConfig = llmConfigFromSettings(options.settings, options.systemLocale);
  if (!llmConfig) {
    throw new Error(
      "LLM is not configured. Set llm.baseUrl, llm.model, and llm.apiKey in settings."
    );
  }
  const llm: LlmRuntimeConfig = llmConfig;
  const paths = await preparePanelDatabasesFromSettings(options.panelHome);
  const desktopDb = paths.desktopDb;

  const homes = resolvePreviewHomes(options.settings, options.panelHome);
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 2, 6));
  const language = llm.outputLanguage?.trim() || DEFAULT_CATALOG_OUTPUT_LANGUAGE;
  const force = options.force === true;
  const refreshIfStale = options.refreshIfStale === true;
  const prefix = options.jobKeyPrefix || "summarize";
  const level = options.progressLevel || "daily";
  const periodLabel = options.progressPeriodLabel || "";
  const onProgress = options.onProgress;
  const progressText = createReportProgressText(options.settings, options.systemLocale);
  const indexDerivedData = options.indexDerivedData !== false;

  const out: AgentSession[] = options.sessions.map((s) => ({ ...s }));
  let summarized = 0;
  let skipped = 0;
  const failed: Array<{ key: string; error: string }> = [];
  const total = out.length;
  let processed = 0;

  if (onProgress && total > 0) {
    onProgress({
      phase: "ensure_summaries",
      level,
      periodLabel,
      message: progressText("desktop.report.prepareSummarize", total),
      index: 0,
      total
    });
  }

  function shouldSkipExistingSummary(session: AgentSession): boolean {
    if (force) {
      return false;
    }
    if (!session.sessionSummary?.trim()) {
      return false;
    }
    if (!refreshIfStale) {
      return true;
    }
    const summaryAt = session.sessionSummaryAtMs;
    if (summaryAt == null || !Number.isFinite(summaryAt)) {
      return false;
    }
    // Session quieter or unchanged since last summary — skip.
    return session.updatedAt <= summaryAt;
  }

  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < out.length) {
      const index = cursor++;
      const session = out[index];
      const key = `${session.provider}:${session.id}`;
      const ref = sessionProgressRef(session);

      if (shouldSkipExistingSummary(session)) {
        skipped += 1;
        processed += 1;
        onProgress?.({
          phase: "session_skip",
          level,
          periodLabel,
          message: progressText("desktop.report.summarySkipped", session.title),
          index: processed,
          total,
          session: ref
        });
        continue;
      }

      onProgress?.({
        phase: "session_start",
        level,
        periodLabel,
        message: progressText("desktop.report.generatingSessionSummary", session.title),
        index: processed + 1,
        total,
        session: ref
      });

      try {
        const summary = await summarizeOneSession({
          catalogDb: options.dbPath,
          desktopDb,
          session,
          llm,
          homes,
          language,
          jobKey: `${prefix}:${key}`,
          settings: options.settings,
          indexDerivedData
        });
        out[index] = {
          ...session,
          sessionSummary: summary,
          sessionSummaryAtMs: Date.now()
        };
        summarized += 1;
        processed += 1;
        onProgress?.({
          phase: "session_done",
          level,
          periodLabel,
          message: progressText("desktop.report.summaryDone", session.title),
          index: processed,
          total,
          session: ref
        });
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        failed.push({ key, error: errMsg });
        processed += 1;
        onProgress?.({
          phase: "session_fail",
          level,
          periodLabel,
          message: progressText("desktop.report.summaryFailed", session.title),
          index: processed,
          total,
          session: ref
        });
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, Math.max(out.length, 1)) }, () =>
    worker()
  );
  await Promise.all(workers);

  return { sessions: out, summarized, skipped, failed };
}

async function summarizeOneSession(input: {
  catalogDb: string;
  desktopDb: string;
  session: AgentSession;
  llm: LlmRuntimeConfig;
  homes: PreviewHomes;
  language: string;
  jobKey: string;
  settings: PanelSettings;
  indexDerivedData: boolean;
}): Promise<string> {
  const preview = await loadSessionPreview(input.session, input.homes);
  if (!preview.messages?.length) {
    throw new Error(preview.warning || "Session has no messages to analyze.");
  }

  try {
    const result = await summarizeSessionMessages(input.llm, preview.messages);
    await recordLlmUsage(input.desktopDb, {
      kind: "chat",
      source: "summarize",
      jobKey: input.jobKey,
      model: result.model,
      usage: result.usage,
      durationMs: result.durationMs,
      ok: true
    });
    await setSessionSummaryInCatalog(
      input.catalogDb,
      input.session.provider,
      input.session.id,
      input.language,
      result.summary
    );
    if (input.indexDerivedData) {
      void upsertSessionEmbedding({
        desktopDb: input.desktopDb,
        settings: input.settings,
        provider: input.session.provider,
        sessionId: input.session.id,
        title: input.session.title,
        summary: result.summary,
        jobKey: `session_embed:${input.jobKey}`
      }).catch(() => undefined);
      void indexSessionTranscript({
        desktopDb: input.desktopDb,
        settings: input.settings,
        session: { ...input.session, sessionSummary: result.summary },
        jobKey: `session_tx_embed:${input.jobKey}`
      }).catch(() => undefined);
    }
    return result.summary;
  } catch (error) {
    await recordLlmUsage(input.desktopDb, {
      kind: "chat",
      source: "summarize",
      jobKey: input.jobKey,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }).catch(() => undefined);
    throw error;
  }
}
