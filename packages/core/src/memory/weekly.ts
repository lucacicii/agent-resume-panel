import { ensureCatalogSchema } from "../catalog/db";
import { chatCompletionDetailed } from "../llm/chat";
import { llmConfigFromSettings } from "../llm/fromSettings";
import { recordLlmUsage } from "../usage/store";
import { catalogDbPath, resolvePanelHome } from "../panelHome";
import { catalogDbFromSettings, effectivePanelHome, loadSettings } from "../settings/store";
import { buildWeeklySourceLines } from "./context";
import { maybeEmbedContent, finalizeDigestEntry } from "./embedStore";
import { localWeekRange } from "./period";
import { DigestProgressCallback } from "./progress";
import { buildWeeklySystemPrompt, buildWeeklyUserPrompt } from "./prompts";
import { MemoryEntry } from "./schema";
import { upsertMemoryJob } from "./store";

export interface RunWeeklyDigestOptions {
  panelHome?: string;
  /** `YYYY-Www` or omit for current ISO week. */
  weekKey?: string;
  skipEmbedding?: boolean;
  /** Re-summarize sessions when falling back to session list (no dailies). */
  forceResummarize?: boolean;
  onProgress?: DigestProgressCallback;
}

export interface RunWeeklyDigestResult {
  entry: MemoryEntry;
  sourceCount: number;
  usedDailies: number;
  summarizedCount: number;
  summarySkippedCount: number;
  summaryFailed: Array<{ key: string; error: string }>;
  jobKey: string;
  embedded: boolean;
  replaced: boolean;
}

export async function runWeeklyDigest(
  options: RunWeeklyDigestOptions = {}
): Promise<RunWeeklyDigestResult> {
  const settings = await loadSettings(options.panelHome);
  const panelHome = options.panelHome
    ? resolvePanelHome(options.panelHome)
    : effectivePanelHome(settings, options.panelHome);
  const dbPath = options.panelHome
    ? catalogDbPath(panelHome)
    : catalogDbFromSettings(settings, options.panelHome);

  await ensureCatalogSchema(dbPath);

  const period = localWeekRange(options.weekKey);
  const onProgress = options.onProgress;
  await upsertMemoryJob(dbPath, period.jobKey, "running");

  try {
    onProgress?.({
      phase: "start",
      level: "weekly",
      periodLabel: period.label,
      message: `生成周报 ${period.label}…（无日报时会先 summarize sessions）`
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
      usedDailies,
      summarizedCount,
      summarySkippedCount,
      summaryFailed
    } = await buildWeeklySourceLines({
      dbPath,
      settings,
      startMs: period.startMs,
      endMs: period.endMs,
      maxSessions,
      panelHome,
      forceResummarize: options.forceResummarize,
      jobKeyPrefix: `summarize:${period.jobKey}`,
      onProgress,
      progressLevel: "weekly",
      progressPeriodLabel: period.label
    });

    onProgress?.({
      phase: "digest",
      level: "weekly",
      periodLabel: period.label,
      message: usedDailies
        ? `从 ${usedDailies} 篇日报提取周报…`
        : `从 session summary 提取周报…`
    });

    const rangeHint = `${new Date(period.startMs).toLocaleDateString()} – ${new Date(period.endMs - 1).toLocaleDateString()}`;
    const language = llm.outputLanguage || "zh-CN";
    const chatResult = await chatCompletionDetailed(
      llm,
      [
        { role: "system", content: buildWeeklySystemPrompt(language) },
        { role: "user", content: buildWeeklyUserPrompt(period.label, rangeHint, lines) }
      ],
      2500
    );
    const content = chatResult.content;
    await recordLlmUsage(dbPath, {
      kind: "chat",
      source: "weekly",
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
        source: "weekly",
        jobKey: period.jobKey,
        model: embedResult.model,
        usage: embedResult.usage,
        durationMs: embedResult.durationMs,
        ok: true
      });
    }

    const entry: MemoryEntry = {
      id: period.entryId,
      level: "weekly",
      periodStartMs: period.startMs,
      periodEndMs: period.endMs,
      title: `Weekly · ${period.label}`,
      content,
      embeddingJson,
      createdAtMs: Date.now()
    };

    const { replaced } = await finalizeDigestEntry(dbPath, entry, [], period.jobKey);
    onProgress?.({
      phase: "complete",
      level: "weekly",
      periodLabel: period.label,
      message: `周报完成 · sources ${sourceCount}`
    });
    return {
      entry,
      sourceCount,
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
      level: "weekly",
      periodLabel: period.label,
      message
    });
    throw error;
  }
}
