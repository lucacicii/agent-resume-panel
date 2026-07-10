import { ensureCatalogSchema } from "../catalog/db";
import { chatCompletionDetailed } from "../llm/chat";
import { llmConfigFromSettings } from "../llm/fromSettings";
import { recordLlmUsage } from "../usage/store";
import { catalogDbPath, resolvePanelHome } from "../panelHome";
import { catalogDbFromSettings, effectivePanelHome, loadSettings } from "../settings/store";
import { buildMonthlySourceLines } from "./context";
import { ensureDailiesForPeriod, EnsureLevelStats } from "./ensureDailies";
import { maybeEmbedContent, finalizeDigestEntry } from "./embedStore";
import { localMonthRange } from "./period";
import { DigestProgressCallback } from "./progress";
import {
  buildMonthlySystemPrompt,
  buildMonthlyUserPrompt,
  normalizeDigestMarkdown
} from "./prompts";
import { MemoryEntry } from "./schema";
import { upsertMemoryJob } from "./store";

export interface RunMonthlyDigestOptions {
  panelHome?: string;
  /** `YYYY-MM` or omit for current month. */
  monthKey?: string;
  skipEmbedding?: boolean;
  forceResummarize?: boolean;
  /** Re-generate dailies even if they exist. Default false. */
  forceEnsureLower?: boolean;
  onProgress?: DigestProgressCallback;
}

export interface RunMonthlyDigestResult {
  entry: MemoryEntry;
  sourceCount: number;
  usedWeeklies: number;
  usedDailies: number;
  /** Dailies ensured for this calendar month only. */
  ensuredDailies: EnsureLevelStats;
  /**
   * @deprecated Monthly no longer ensures weeklies; always empty stats for API compat.
   */
  ensuredWeeklies: EnsureLevelStats;
  jobKey: string;
  embedded: boolean;
  replaced: boolean;
  summarizedCount: number;
  summarySkippedCount: number;
  summaryFailed: Array<{ key: string; error: string }>;
}

const EMPTY_ENSURE: EnsureLevelStats = {
  planned: [],
  ok: [],
  skipped: [],
  failed: []
};

export async function runMonthlyDigest(
  options: RunMonthlyDigestOptions = {}
): Promise<RunMonthlyDigestResult> {
  const settings = await loadSettings(options.panelHome);
  const panelHome = options.panelHome
    ? resolvePanelHome(options.panelHome)
    : effectivePanelHome(settings, options.panelHome);
  const dbPath = options.panelHome
    ? catalogDbPath(panelHome)
    : catalogDbFromSettings(settings, options.panelHome);

  await ensureCatalogSchema(dbPath);

  const period = localMonthRange(options.monthKey);
  const onProgress = options.onProgress;
  await upsertMemoryJob(dbPath, period.jobKey, "running");

  try {
    onProgress?.({
      phase: "start",
      level: "monthly",
      periodLabel: period.label,
      message: `生成月报 ${period.label}…（先检查并补全本月日报）`
    });

    const llm = llmConfigFromSettings(settings);
    if (!llm) {
      throw new Error(
        "LLM is not configured. Set llm.baseUrl, llm.model, and llm.apiKey in ~/.agent-resume-panel/settings.json"
      );
    }

    // Calendar month only — no ISO week cascade (avoids spanning two months).
    const ensuredDailies = await ensureDailiesForPeriod({
      dbPath,
      startMs: period.startMs,
      endMs: period.endMs,
      panelHome,
      skipExisting: !options.forceEnsureLower,
      skipEmbedding: options.skipEmbedding,
      forceResummarize: options.forceResummarize,
      onProgress,
      progressLevel: "monthly",
      progressPeriodLabel: period.label
    });

    const { lines, sourceCount, usedWeeklies, usedDailies } = await buildMonthlySourceLines({
      dbPath,
      startMs: period.startMs,
      endMs: period.endMs,
      onProgress,
      progressLevel: "monthly",
      progressPeriodLabel: period.label
    });

    onProgress?.({
      phase: "digest",
      level: "monthly",
      periodLabel: period.label,
      message: usedDailies
        ? `从本月 ${usedDailies} 篇日报提取月报…`
        : `本月无日报，生成占位月报…`
    });

    const rangeHint = `${new Date(period.startMs).toLocaleDateString()} – ${new Date(period.endMs - 1).toLocaleDateString()}`;
    const language = llm.outputLanguage || "zh-CN";
    const chatResult = await chatCompletionDetailed(
      llm,
      [
        { role: "system", content: buildMonthlySystemPrompt(language) },
        { role: "user", content: buildMonthlyUserPrompt(period.label, rangeHint, lines, language) }
      ],
      3000
    );
    const content = normalizeDigestMarkdown(chatResult.content);
    await recordLlmUsage(dbPath, {
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
      await recordLlmUsage(dbPath, {
        kind: "embedding",
        source: "monthly",
        jobKey: period.jobKey,
        model: embedResult.model,
        usage: embedResult.usage,
        durationMs: embedResult.durationMs,
        ok: true
      });
    }

    const entry: MemoryEntry = {
      id: period.entryId,
      level: "monthly",
      periodStartMs: period.startMs,
      periodEndMs: period.endMs,
      title: `Monthly · ${period.label}`,
      content,
      embeddingJson,
      createdAtMs: Date.now()
    };

    const { replaced } = await finalizeDigestEntry(dbPath, entry, [], period.jobKey);
    onProgress?.({
      phase: "complete",
      level: "monthly",
      periodLabel: period.label,
      message: `月报完成 · dailies ${usedDailies} · 补全 +${ensuredDailies.ok.length}/skip ${ensuredDailies.skipped.length}`
    });
    return {
      entry,
      sourceCount,
      usedWeeklies,
      usedDailies,
      ensuredDailies,
      ensuredWeeklies: EMPTY_ENSURE,
      summarizedCount: 0,
      summarySkippedCount: 0,
      summaryFailed: ensuredDailies.failed,
      jobKey: period.jobKey,
      embedded,
      replaced
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await upsertMemoryJob(dbPath, period.jobKey, "error", message);
    onProgress?.({
      phase: "error",
      level: "monthly",
      periodLabel: period.label,
      message
    });
    throw error;
  }
}
