import { ensureCatalogSchema } from "../catalog/db";
import { chatCompletionDetailed } from "../llm/chat";
import { llmConfigFromSettings } from "../llm/fromSettings";
import { recordLlmUsage } from "../usage/store";
import { catalogDbPath, resolvePanelHome } from "../panelHome";
import { catalogDbFromSettings, effectivePanelHome, loadSettings } from "../settings/store";
import { buildMonthlySourceLines } from "./context";
import { maybeEmbedContent, finalizeDigestEntry } from "./embedStore";
import { localMonthRange } from "./period";
import { DigestProgressCallback } from "./progress";
import { buildMonthlySystemPrompt, buildMonthlyUserPrompt } from "./prompts";
import { MemoryEntry } from "./schema";
import { upsertMemoryJob } from "./store";

export interface RunMonthlyDigestOptions {
  panelHome?: string;
  /** `YYYY-MM` or omit for current month. */
  monthKey?: string;
  skipEmbedding?: boolean;
  /** Re-summarize sessions when falling back to session list. */
  forceResummarize?: boolean;
  onProgress?: DigestProgressCallback;
}

export interface RunMonthlyDigestResult {
  entry: MemoryEntry;
  sourceCount: number;
  usedWeeklies: number;
  usedDailies: number;
  summarizedCount: number;
  summarySkippedCount: number;
  summaryFailed: Array<{ key: string; error: string }>;
  jobKey: string;
  embedded: boolean;
  replaced: boolean;
}

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
      message: `生成月报 ${period.label}…（无周报/日报时会先 summarize sessions）`
    });

    const llm = llmConfigFromSettings(settings);
    if (!llm) {
      throw new Error(
        "LLM is not configured. Set llm.baseUrl, llm.model, and llm.apiKey in ~/.agent-resume-panel/settings.json"
      );
    }

    const maxSessions = Math.max(1, Math.min(settings.memory?.maxSessionsPerDigest ?? 40, 200));
    const {
      lines,
      sourceCount,
      usedWeeklies,
      usedDailies,
      summarizedCount,
      summarySkippedCount,
      summaryFailed
    } = await buildMonthlySourceLines({
      dbPath,
      settings,
      startMs: period.startMs,
      endMs: period.endMs,
      maxSessions,
      panelHome,
      forceResummarize: options.forceResummarize,
      jobKeyPrefix: `summarize:${period.jobKey}`,
      onProgress,
      progressLevel: "monthly",
      progressPeriodLabel: period.label
    });

    onProgress?.({
      phase: "digest",
      level: "monthly",
      periodLabel: period.label,
      message: usedWeeklies
        ? `从 ${usedWeeklies} 篇周报提取月报…`
        : usedDailies
          ? `从 ${usedDailies} 篇日报提取月报…`
          : `从 session summary 提取月报…`
    });

    const rangeHint = `${new Date(period.startMs).toLocaleDateString()} – ${new Date(period.endMs - 1).toLocaleDateString()}`;
    const language = llm.outputLanguage || "zh-CN";
    const chatResult = await chatCompletionDetailed(
      llm,
      [
        { role: "system", content: buildMonthlySystemPrompt(language) },
        { role: "user", content: buildMonthlyUserPrompt(period.label, rangeHint, lines) }
      ],
      3000
    );
    const content = chatResult.content;
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
      message: `月报完成 · sources ${sourceCount}`
    });
    return {
      entry,
      sourceCount,
      usedWeeklies,
      usedDailies,
      summarizedCount,
      summarySkippedCount,
      summaryFailed,
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
