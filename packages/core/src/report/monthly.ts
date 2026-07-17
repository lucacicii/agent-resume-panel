import { preparePanelDatabasesFromSettings } from "../dbPaths";
import { chatCompletionDetailed } from "../llm/chat";
import { DEFAULT_CATALOG_OUTPUT_LANGUAGE } from "../i18n/outputLanguage";
import { llmConfigFromSettings } from "../llm/fromSettings";
import { recordLlmUsage } from "../usage/store";
import { effectivePanelHome, loadSettings } from "../settings/store";
import { buildMonthlySourceLines } from "./context";
import { EnsureLevelStats } from "./ensureDailies";
import {
  ensureFreshDailiesForPeriod,
  ensureFreshWeekliesForPeriod
} from "./ensureFreshDigests";
import { maybeEmbedContent, finalizeDigestEntry } from "./embedStore";
import { localMonthRange } from "./period";
import { createReportProgressText } from "./progressI18n";
import { DigestProgressCallback } from "./progress";
import {
  buildMonthlySystemPrompt,
  buildMonthlyUserPrompt,
  normalizeDigestMarkdown
} from "./prompts";
import { ReportEntry } from "./schema";
import { upsertReportJob } from "./store";

export interface RunMonthlyDigestOptions {
  panelHome?: string;
  /** `YYYY-MM` or omit for current month. */
  monthKey?: string;
  skipEmbedding?: boolean;
  forceResummarize?: boolean;
  /** Re-generate dailies even if they exist. Default false. */
  forceEnsureLower?: boolean;
  onProgress?: DigestProgressCallback;
  systemLocale?: string;
}

export interface RunMonthlyDigestResult {
  entry: ReportEntry;
  sourceCount: number;
  usedWeeklies: number;
  usedDailies: number;
  /** Dailies ensured for this calendar month only. */
  ensuredDailies: EnsureLevelStats;
  /** Weeklies refreshed in this calendar month before monthly aggregation. */
  ensuredWeeklies: EnsureLevelStats;
  jobKey: string;
  embedded: boolean;
  replaced: boolean;
  summarizedCount: number;
  summarySkippedCount: number;
  summaryFailed: Array<{ key: string; error: string }>;
}

export async function runMonthlyDigest(
  options: RunMonthlyDigestOptions = {}
): Promise<RunMonthlyDigestResult> {
  const settings = await loadSettings(options.panelHome);
  const pt = createReportProgressText(settings, options.systemLocale);
  const panelHome = effectivePanelHome(settings, options.panelHome);
  const paths = await preparePanelDatabasesFromSettings(options.panelHome);
  const catalogDb = paths.catalogDb;
  const desktopDb = paths.desktopDb;

  const period = localMonthRange(options.monthKey);
  const onProgress = options.onProgress;
  await upsertReportJob(desktopDb, period.jobKey, "running");

  try {
    onProgress?.({
      phase: "start",
      level: "monthly",
      periodLabel: period.label,
      message: pt("desktop.report.generatingMonthlyCascade", period.label)
    });

    const llm = llmConfigFromSettings(settings);
    if (!llm) {
      throw new Error(
        "LLM is not configured. Set llm.baseUrl, llm.model, and llm.apiKey in ~/.agent-resume-panel/settings.json"
      );
    }

    const ensuredDailies = await ensureFreshDailiesForPeriod({
      catalogDb,
      desktopDb,
      startMs: period.startMs,
      endMs: period.endMs,
      panelHome,
      forceRefresh: options.forceEnsureLower,
      skipEmbedding: options.skipEmbedding,
      forceResummarize: options.forceResummarize,
      onProgress,
      systemLocale: options.systemLocale,
      progressLevel: "monthly",
      progressPeriodLabel: period.label
    });

    const ensuredWeeklies = await ensureFreshWeekliesForPeriod({
      catalogDb,
      desktopDb,
      startMs: period.startMs,
      endMs: period.endMs,
      panelHome,
      forceRefresh: options.forceEnsureLower,
      skipEmbedding: options.skipEmbedding,
      forceResummarize: options.forceResummarize,
      onProgress,
      systemLocale: options.systemLocale,
      progressLevel: "monthly",
      progressPeriodLabel: period.label
    });

    const { lines, sourceCount, usedWeeklies, usedDailies } = await buildMonthlySourceLines({
      dbPath: desktopDb,
      startMs: period.startMs,
      endMs: period.endMs,
      onProgress,
      progressLevel: "monthly",
      progressPeriodLabel: period.label,
      progressText: pt
    });

    onProgress?.({
      phase: "digest",
      level: "monthly",
      periodLabel: period.label,
      message: usedDailies
        ? pt("desktop.report.extractMonthlyFromDailies", usedDailies)
        : pt("desktop.report.extractMonthlyPlaceholder")
    });

    const rangeHint = `${new Date(period.startMs).toLocaleDateString()} – ${new Date(period.endMs - 1).toLocaleDateString()}`;
    const language = llm.outputLanguage || DEFAULT_CATALOG_OUTPUT_LANGUAGE;
    const chatResult = await chatCompletionDetailed(
      llm,
      [
        { role: "system", content: buildMonthlySystemPrompt(language) },
        { role: "user", content: buildMonthlyUserPrompt(period.label, rangeHint, lines, language) }
      ],
      3000
    );
    const content = normalizeDigestMarkdown(chatResult.content);
    await recordLlmUsage(desktopDb, {
      kind: "chat",
      source: "monthly",
      jobKey: period.jobKey,
      model: chatResult.model,
      usage: chatResult.usage,
      durationMs: chatResult.durationMs,
      ok: true
    });

    const embedResult = await maybeEmbedContent(settings, content, options.skipEmbedding);
    const { embeddingJson, embedded } = embedResult;
    if (embedded) {
      await recordLlmUsage(desktopDb, {
        kind: "embedding",
        source: "monthly",
        jobKey: period.jobKey,
        model: embedResult.model,
        usage: embedResult.usage,
        durationMs: embedResult.durationMs,
        ok: true
      });
    }

    const entry: ReportEntry = {
      id: period.entryId,
      level: "monthly",
      periodStartMs: period.startMs,
      periodEndMs: period.endMs,
      title: `Monthly · ${period.label}`,
      content,
      embeddingJson,
      createdAtMs: Date.now()
    };

    const { replaced } = await finalizeDigestEntry(desktopDb, entry, [], period.jobKey);
    onProgress?.({
      phase: "complete",
      level: "monthly",
      periodLabel: period.label,
      message: pt(
        "desktop.report.monthlyCompleteStats",
        usedDailies,
        ensuredDailies.ok.length,
        ensuredWeeklies.ok.length
      )
    });
    return {
      entry,
      sourceCount,
      usedWeeklies,
      usedDailies,
      ensuredDailies,
      ensuredWeeklies,
      summarizedCount: 0,
      summarySkippedCount: 0,
      summaryFailed: ensuredDailies.failed,
      jobKey: period.jobKey,
      embedded,
      replaced
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await upsertReportJob(desktopDb, period.jobKey, "error", message);
    onProgress?.({
      phase: "error",
      level: "monthly",
      periodLabel: period.label,
      message
    });
    throw error;
  }
}