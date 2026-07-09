import { ensureCatalogSchema } from "../catalog/db";
import { chatCompletion } from "../llm/chat";
import { llmConfigFromSettings } from "../llm/fromSettings";
import { catalogDbPath, resolvePanelHome } from "../panelHome";
import { catalogDbFromSettings, effectivePanelHome, loadSettings } from "../settings/store";
import { buildWeeklySourceLines } from "./context";
import { maybeEmbedContent, finalizeDigestEntry } from "./embedStore";
import { localWeekRange } from "./period";
import { buildWeeklySystemPrompt, buildWeeklyUserPrompt } from "./prompts";
import { MemoryEntry } from "./schema";
import { upsertMemoryJob } from "./store";

export interface RunWeeklyDigestOptions {
  panelHome?: string;
  /** `YYYY-Www` or omit for current ISO week. */
  weekKey?: string;
  skipEmbedding?: boolean;
}

export interface RunWeeklyDigestResult {
  entry: MemoryEntry;
  sourceCount: number;
  usedDailies: number;
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
  await upsertMemoryJob(dbPath, period.jobKey, "running");

  try {
    const llm = llmConfigFromSettings(settings);
    if (!llm) {
      throw new Error(
        "LLM is not configured. Set llm.baseUrl, llm.model, and llm.apiKey in ~/.agent-resume-panel/settings.json"
      );
    }

    const maxSessions = Math.max(1, Math.min(settings.memory?.maxSessionsPerDigest ?? 40, 200));
    const { lines, sourceCount, usedDailies } = await buildWeeklySourceLines(
      dbPath,
      period.startMs,
      period.endMs,
      maxSessions
    );

    const rangeHint = `${new Date(period.startMs).toLocaleDateString()} – ${new Date(period.endMs - 1).toLocaleDateString()}`;
    const language = llm.outputLanguage || "zh-CN";
    const content = await chatCompletion(
      llm,
      [
        { role: "system", content: buildWeeklySystemPrompt(language) },
        { role: "user", content: buildWeeklyUserPrompt(period.label, rangeHint, lines) }
      ],
      2500
    );

    const { embeddingJson, embedded } = await maybeEmbedContent(
      settings,
      content,
      options.skipEmbedding
    );

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
    return {
      entry,
      sourceCount,
      usedDailies,
      jobKey: period.jobKey,
      embedded,
      replaced
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await upsertMemoryJob(dbPath, period.jobKey, "error", message);
    throw error;
  }
}
