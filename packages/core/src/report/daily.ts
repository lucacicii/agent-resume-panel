import { listAllSessionsInRange } from "../catalog/query";
import { AgentSession } from "../catalog/types";
import { preparePanelDatabasesFromSettings } from "../dbPaths";
import { DEFAULT_CATALOG_OUTPUT_LANGUAGE } from "../i18n/outputLanguage";
import { llmConfigFromSettings } from "../llm/fromSettings";
import { effectivePanelHome, loadSettings } from "../settings/store";
import type { PanelSettings } from "../settings/types";
import { ensureSummariesForSessions } from "../session/ensureSummaries";
import { recordLlmUsage } from "../usage/store";
import { maybeEmbedContent, finalizeDigestEntry } from "./embedStore";
import { assertDigestCallBudget, estimateDailyForSessions, type DigestRunTrigger } from "./digestBudget";
import { runHierarchicalDigest } from "./hierarchicalDigest";
import { localDayRange as localDayRangeImpl } from "./period";
import { createReportProgressText } from "./progressI18n";
import { DigestProgressCallback } from "./progress";
import {
  buildDailySystemPrompt,
  buildDailyUserPrompt,
  formatSessionForDigest,
  normalizeDigestMarkdown
} from "./prompts";
import { ReportEntry } from "./schema";
import { listReportEntriesInRange, listReportLinks, upsertReportJob } from "./store";

export interface RunDailyDigestOptions {
  panelHome?: string;
  /** Local calendar date YYYY-MM-DD; default today. */
  date?: string;
  skipEmbedding?: boolean;
  /** @deprecated Session summaries refresh automatically when stale. */
  forceResummarize?: boolean;
  onProgress?: DigestProgressCallback;
  systemLocale?: string;
  allowOverBudget?: boolean;
  trigger?: DigestRunTrigger;
  /** @deprecated Digests use session summaries. Kept for API compatibility. */
  includeTranscripts?: boolean;
}

export interface RunDailyDigestResult {
  entry: ReportEntry;
  /** All visible catalog sessions in the day. */
  sessionCount: number;
  /** Sessions actually included in this digest; equal to sessionCount. */
  includedSessionCount: number;
  /** @deprecated Always 0 because report generation no longer drops sessions. */
  omittedSessionCount: number;
  /** Number of initial source chunks used by hierarchical generation. */
  chunkCount: number;
  summaryReadyCount: number;
  summarizedCount: number;
  summarySkippedCount: number;
  summaryFailed: Array<{ key: string; error: string }>;
  /** @deprecated Alias of summaryReadyCount. */
  snippetCount: number;
  jobKey: string;
  embedded: boolean;
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
  linkedSessionCount: number;
  newSessionCount: number;
  updatedSessionCount: number;
  omittedSessionCount: number;
  digestCreatedAtMs?: number;
  message: string;
}

export interface DailyDigestRefreshContext {
  settings: PanelSettings;
  catalogDb: string;
  desktopDb: string;
  date?: string;
  systemLocale?: string;
}

/** Evaluate one daily against the complete current session set and all report links. */
export async function evaluateDailyDigestRefresh(
  options: DailyDigestRefreshContext
): Promise<DailyDigestRefreshCheck> {
  const pt = createReportProgressText(options.settings, options.systemLocale);
  const period = localDayRangeImpl(options.date);
  const sessions = await listAllSessionsInRange(options.catalogDb, period.startMs, period.endMs);
  const sessionCount = sessions.length;
  const entries = await listReportEntriesInRange(options.desktopDb, {
    level: "daily",
    startMs: period.startMs,
    endMs: period.endMs,
    limit: 20
  });
  const entry = entries.sort((a, b) => b.createdAtMs - a.createdAtMs)[0];

  if (!entry?.content?.trim()) {
    if (!sessionCount) {
      return {
        needed: false,
        reason: "no_sessions",
        sessionCount: 0,
        linkedSessionCount: 0,
        newSessionCount: 0,
        updatedSessionCount: 0,
        omittedSessionCount: 0,
        message: pt("desktop.report.refreshNoSessionsSkip")
      };
    }
    return {
      needed: true,
      reason: "missing",
      sessionCount,
      linkedSessionCount: 0,
      newSessionCount: sessionCount,
      updatedSessionCount: 0,
      omittedSessionCount: 0,
      message: pt("desktop.report.refreshDailyMissing", sessionCount)
    };
  }

  const links = await listReportLinks(options.desktopDb, entry.id);
  const linked = new Set(
    links
      .filter((link) => link.provider && link.agentSessionId)
      .map((link) => `${link.provider}:${link.agentSessionId}`)
  );
  const expectedSessions = sessions;
  const linkedSessionCount = sessions.reduce(
    (count, session) => count + (linked.has(`${session.provider}:${session.id}`) ? 1 : 0),
    0
  );
  const newSessionCount = expectedSessions.reduce(
    (count, session) => count + (linked.has(`${session.provider}:${session.id}`) ? 0 : 1),
    0
  );
  const updatedSessionCount = expectedSessions.reduce(
    (count, session) => count + (session.updatedAt > entry.createdAtMs ? 1 : 0),
    0
  );
  const omittedSessionCount = Math.max(0, sessionCount - linkedSessionCount);

  if (newSessionCount > 0) {
    return {
      needed: true,
      reason: "new_sessions",
      sessionCount,
      linkedSessionCount,
      newSessionCount,
      updatedSessionCount,
      omittedSessionCount,
      digestCreatedAtMs: entry.createdAtMs,
      message: pt("desktop.report.refreshNewSessionsDaily", newSessionCount)
    };
  }
  if (updatedSessionCount > 0) {
    return {
      needed: true,
      reason: "updated_sessions",
      sessionCount,
      linkedSessionCount,
      newSessionCount: 0,
      updatedSessionCount,
      omittedSessionCount,
      digestCreatedAtMs: entry.createdAtMs,
      message: pt("desktop.report.refreshUpdatedSessionsDaily", updatedSessionCount)
    };
  }
  return {
    needed: false,
    reason: "up_to_date",
    sessionCount,
    linkedSessionCount,
    newSessionCount: 0,
    updatedSessionCount: 0,
    omittedSessionCount: 0,
    digestCreatedAtMs: entry.createdAtMs,
    message: pt("desktop.report.refreshDailyUpToDateCount", sessionCount)
  };
}

export async function needsDailyDigestRefresh(
  options: { panelHome?: string; date?: string; systemLocale?: string } = {}
): Promise<DailyDigestRefreshCheck> {
  const settings = await loadSettings(options.panelHome);
  const paths = await preparePanelDatabasesFromSettings(options.panelHome);
  return evaluateDailyDigestRefresh({
    settings,
    catalogDb: paths.catalogDb,
    desktopDb: paths.desktopDb,
    date: options.date,
    systemLocale: options.systemLocale
  });
}

export async function runDailyDigest(
  options: RunDailyDigestOptions = {}
): Promise<RunDailyDigestResult> {
  const settings = await loadSettings(options.panelHome);
  const pt = createReportProgressText(settings, options.systemLocale);
  const panelHome = effectivePanelHome(settings, options.panelHome);
  const paths = await preparePanelDatabasesFromSettings(options.panelHome);
  const catalogDb = paths.catalogDb;
  const desktopDb = paths.desktopDb;
  const period = localDayRangeImpl(options.date);
  const { startMs, endMs, label: dateLabel, jobKey, entryId } = period;
  const onProgress = options.onProgress;
  await upsertReportJob(desktopDb, jobKey, "running");

  try {
    onProgress?.({
      phase: "start",
      level: "daily",
      periodLabel: dateLabel,
      dayKey: dateLabel,
      message: pt("desktop.report.startDaily", dateLabel)
    });

    const llm = llmConfigFromSettings(settings);
    if (!llm) {
      throw new Error(
        "LLM is not configured. Set llm.baseUrl, llm.model, and llm.apiKey in Desktop Settings."
      );
    }

    const allSessions = await listAllSessionsInRange(catalogDb, startMs, endMs);
    const totalFound = allSessions.length;
    let sessions = allSessions;
    const estimate = estimateDailyForSessions(settings, dateLabel, sessions);
    assertDigestCallBudget(estimate, options.allowOverBudget);
    const omittedSessionCount = 0;

    const ensure = await ensureSummariesForSessions({
      dbPath: catalogDb,
      sessions,
      settings,
      panelHome,
      force: false,
      refreshIfStale: true,
      jobKeyPrefix: `summarize:${jobKey}`,
      onProgress,
      systemLocale: options.systemLocale,
      progressLevel: "daily",
      progressPeriodLabel: dateLabel
    });
    const failedSummaryKeys = new Set(ensure.failed.map((failure) => failure.key));
    sessions = ensure.sessions.map((session) =>
      failedSummaryKeys.has(`${session.provider}:${session.id}`)
        ? { ...session, sessionSummary: undefined, sessionSummaryAtMs: undefined }
        : session
    );

    const lines: string[] = [];
    let summaryReadyCount = 0;
    for (const session of sessions) {
      if (session.sessionSummary?.trim()) summaryReadyCount += 1;
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
    onProgress?.({
      phase: "digest",
      level: "daily",
      periodLabel: dateLabel,
      dayKey: dateLabel,
      message: pt("desktop.report.extractDailyFromSummary", dateLabel)
    });

    const language = llm.outputLanguage || DEFAULT_CATALOG_OUTPUT_LANGUAGE;
    const generated = await runHierarchicalDigest({
      llm,
      desktopDb,
      source: "daily",
      jobKey,
      level: "daily",
      periodLabel: dateLabel,
      outputLanguage: language,
      sourceItems: lines,
      finalSystemPrompt: buildDailySystemPrompt(language),
      buildFinalUserPrompt: (items) => buildDailyUserPrompt(dateLabel, items, language),
      maxTokens: 2000,
      onProgress,
      progressMessage: (current, total) => pt("desktop.report.chunkProgress", current, total),
      reduceMessage: (round) => pt("desktop.report.reduceProgress", round)
    });
    const content = normalizeDigestMarkdown(generated.content);

    onProgress?.({
      phase: "embed",
      level: "daily",
      periodLabel: dateLabel,
      dayKey: dateLabel,
      message: options.skipEmbedding
        ? pt("desktop.report.skipEmbedding")
        : pt("desktop.report.writeEmbedding")
    });

    const embedResult = await maybeEmbedContent(settings, content, options.skipEmbedding);
    const { embeddingJson, embedded } = embedResult;
    if (embedded) {
      await recordLlmUsage(desktopDb, {
        kind: "embedding",
        source: "daily",
        jobKey,
        model: embedResult.model,
        usage: embedResult.usage,
        durationMs: embedResult.durationMs,
        ok: true
      });
    }

    const entry: ReportEntry = {
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
      desktopDb,
      entry,
      sessions.map((session: AgentSession) => ({
        provider: session.provider,
        agentSessionId: session.id,
        projectPath: session.projectPath
      })),
      jobKey
    );

    onProgress?.({
      phase: "complete",
      level: "daily",
      periodLabel: dateLabel,
      dayKey: dateLabel,
      message: pt(
        "desktop.report.dailyCompleteStats",
        sessions.length,
        totalFound,
        generated.chunkCount
      )
    });

    return {
      entry,
      sessionCount: totalFound,
      includedSessionCount: sessions.length,
      omittedSessionCount,
      chunkCount: generated.chunkCount,
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
    await upsertReportJob(desktopDb, jobKey, "error", message);
    onProgress?.({
      phase: "error",
      level: "daily",
      periodLabel: dateLabel,
      dayKey: dateLabel,
      message
    });
    throw error;
  }
}
