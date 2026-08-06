import { preparePanelDatabasesFromSettings } from "../dbPaths";
import { DEFAULT_CATALOG_OUTPUT_LANGUAGE } from "../i18n/outputLanguage";
import { llmConfigFromSettings } from "../llm/fromSettings";
import { recordLlmUsage } from "../usage/store";
import { effectivePanelHome, loadSettings } from "../settings/store";
import { buildWeeklySourceLines } from "./context";
import { EnsureLevelStats } from "./ensureDailies";
import { ensureFreshDailiesForPeriod } from "./ensureFreshDigests";
import { maybeEmbedContent, finalizeDigestEntry } from "./embedStore";
import { assertDigestCallBudget, estimateDigestRun, type DigestRunTrigger } from "./digestBudget";
import { runHierarchicalDigest } from "./hierarchicalDigest";
import { localWeekRange } from "./period";
import { createReportProgressText } from "./progressI18n";
import { DigestProgressCallback } from "./progress";
import {
  buildWeeklySystemPrompt,
  buildWeeklyUserPrompt,
  normalizeDigestMarkdown
} from "./prompts";
import { ReportEntry } from "./schema";
import { upsertReportJob } from "./store";

export interface RunWeeklyDigestOptions {
  panelHome?: string;
  /** `YYYY-Www` or omit for current ISO week. */
  weekKey?: string;
  skipEmbedding?: boolean;
  /** Re-summarize sessions when generating missing dailies. */
  forceResummarize?: boolean;
  /** Re-generate dailies even if they exist. Default false. */
  forceEnsureLower?: boolean;
  onProgress?: DigestProgressCallback;
  systemLocale?: string;
  allowOverBudget?: boolean;
  trigger?: DigestRunTrigger;
}

export interface RunWeeklyDigestResult {
  entry: ReportEntry;
  sourceCount: number;
  usedDailies: number;
  ensuredDailies: EnsureLevelStats;
  jobKey: string;
  embedded: boolean;
  replaced: boolean;
  /** @deprecated kept for UI that still reads summarize counts */
  summarizedCount: number;
  summarySkippedCount: number;
  summaryFailed: Array<{ key: string; error: string }>;
  chunkCount: number;
}

export async function runWeeklyDigest(
  options: RunWeeklyDigestOptions = {}
): Promise<RunWeeklyDigestResult> {
  const settings = await loadSettings(options.panelHome);
  const pt = createReportProgressText(settings, options.systemLocale);
  const panelHome = effectivePanelHome(settings, options.panelHome);
  const paths = await preparePanelDatabasesFromSettings(options.panelHome);
  const catalogDb = paths.catalogDb;
  const desktopDb = paths.desktopDb;

  const period = localWeekRange(options.weekKey);
  const onProgress = options.onProgress;
  await upsertReportJob(desktopDb, period.jobKey, "running");

  try {
    onProgress?.({
      phase: "start",
      level: "weekly",
      periodLabel: period.label,
      message: pt("desktop.report.generatingWeeklyCascade", period.label)
    });

    const llm = llmConfigFromSettings(settings);
    if (!llm) {
      throw new Error(
        "LLM is not configured. Set llm.baseUrl, llm.model, and llm.apiKey in ~/.agent-resume-panel/settings.json"
      );
    }

    const estimate = await estimateDigestRun({
      panelHome: options.panelHome,
      level: "weekly",
      periodKey: period.label
    });
    assertDigestCallBudget(estimate, options.allowOverBudget);

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
      progressLevel: "weekly",
      progressPeriodLabel: period.label,
      allowOverBudget: options.allowOverBudget,
      trigger: options.trigger
    });

    const { lines, sourceCount, usedDailies } = await buildWeeklySourceLines({
      dbPath: desktopDb,
      startMs: period.startMs,
      endMs: period.endMs,
      onProgress,
      progressLevel: "weekly",
      progressPeriodLabel: period.label,
      progressText: pt
    });

    onProgress?.({
      phase: "digest",
      level: "weekly",
      periodLabel: period.label,
      message: usedDailies
        ? pt("desktop.report.extractWeeklyFromDailies", usedDailies)
        : pt("desktop.report.extractWeeklyPlaceholder")
    });

    const rangeHint = `${new Date(period.startMs).toLocaleDateString()} – ${new Date(period.endMs - 1).toLocaleDateString()}`;
    const language = llm.outputLanguage || DEFAULT_CATALOG_OUTPUT_LANGUAGE;
    const generated = await runHierarchicalDigest({
      llm,
      desktopDb,
      source: "weekly",
      jobKey: period.jobKey,
      level: "weekly",
      periodLabel: period.label,
      outputLanguage: language,
      sourceItems: lines,
      finalSystemPrompt: buildWeeklySystemPrompt(language),
      buildFinalUserPrompt: (items) => buildWeeklyUserPrompt(period.label, rangeHint, items, language),
      maxTokens: 8000,
      onProgress,
      progressMessage: (current, total) => pt("desktop.report.chunkProgress", current, total),
      reduceMessage: (round) => pt("desktop.report.reduceProgress", round)
    });
    const content = normalizeDigestMarkdown(generated.content);

    const embedResult = await maybeEmbedContent(settings, content, options.skipEmbedding);
    const { embeddingJson, embedded } = embedResult;
    if (embedded) {
      await recordLlmUsage(desktopDb, {
        kind: "embedding",
        source: "weekly",
        jobKey: period.jobKey,
        model: embedResult.model,
        usage: embedResult.usage,
        durationMs: embedResult.durationMs,
        ok: true
      });
    }

    const entry: ReportEntry = {
      id: period.entryId,
      level: "weekly",
      periodStartMs: period.startMs,
      periodEndMs: period.endMs,
      title: `Weekly · ${period.label}`,
      content,
      embeddingJson,
      createdAtMs: Date.now()
    };

    const { replaced } = await finalizeDigestEntry(desktopDb, entry, [], period.jobKey);
    onProgress?.({
      phase: "complete",
      level: "weekly",
      periodLabel: period.label,
      message: pt(
        "desktop.report.weeklyCompleteStats",
        usedDailies,
        ensuredDailies.ok.length,
        ensuredDailies.skipped.length
      )
    });
    return {
      entry,
      sourceCount,
      usedDailies,
      ensuredDailies,
      summarizedCount: 0,
      summarySkippedCount: 0,
      summaryFailed: ensuredDailies.failed,
      chunkCount: generated.chunkCount,
      jobKey: period.jobKey,
      embedded,
      replaced
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await upsertReportJob(desktopDb, period.jobKey, "error", message);
    onProgress?.({
      phase: "error",
      level: "weekly",
      periodLabel: period.label,
      message
    });
    throw error;
  }
}