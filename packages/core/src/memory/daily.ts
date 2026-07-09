import { randomUUID } from "node:crypto";
import { ensureCatalogSchema } from "../catalog/db";
import { listSessionsInRange } from "../catalog/query";
import { chatCompletion } from "../llm/chat";
import { embedTexts } from "../llm/embeddings";
import { embeddingConfigFromSettings, llmConfigFromSettings } from "../llm/fromSettings";
import { catalogDbPath, resolvePanelHome } from "../panelHome";
import { catalogDbFromSettings, effectivePanelHome, loadSettings } from "../settings/store";
import { buildDailySystemPrompt, buildDailyUserPrompt, formatSessionForDigest } from "./prompts";
import { MemoryEntry } from "./schema";
import { insertMemoryEntry, upsertMemoryJob } from "./store";

export interface RunDailyDigestOptions {
  /** Override panel home (default from settings / ~/.agent-resume-panel). */
  panelHome?: string;
  /** Local calendar date YYYY-MM-DD; default today. */
  date?: string;
  /** Skip embedding even if configured. */
  skipEmbedding?: boolean;
}

export interface RunDailyDigestResult {
  entry: MemoryEntry;
  sessionCount: number;
  jobKey: string;
  embedded: boolean;
}

/** Local day bounds [start, end) in ms. */
export function localDayRange(dateStr?: string): { startMs: number; endMs: number; dateLabel: string; jobKey: string } {
  const now = new Date();
  let y: number;
  let m: number;
  let d: number;

  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [ys, ms, ds] = dateStr.split("-").map(Number);
    y = ys;
    m = ms;
    d = ds;
  } else {
    y = now.getFullYear();
    m = now.getMonth() + 1;
    d = now.getDate();
  }

  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
  const dateLabel = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  return {
    startMs: start.getTime(),
    endMs: end.getTime(),
    dateLabel,
    jobKey: `daily:${dateLabel}`
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

  const { startMs, endMs, dateLabel, jobKey } = localDayRange(options.date);
  await upsertMemoryJob(dbPath, jobKey, "running");

  try {
    const llm = llmConfigFromSettings(settings);
    if (!llm) {
      throw new Error(
        "LLM is not configured. Set llm.baseUrl, llm.model, and llm.apiKey in ~/.agent-resume-panel/settings.json"
      );
    }

    const sessions = await listSessionsInRange(dbPath, startMs, endMs);
    const lines = sessions.map((s) =>
      formatSessionForDigest({
        provider: s.provider,
        title: s.title,
        projectPath: s.projectPath,
        summary: s.sessionSummary,
        updatedAt: s.updatedAt
      })
    );

    const language = llm.outputLanguage || "zh-CN";
    const content = await chatCompletion(
      llm,
      [
        { role: "system", content: buildDailySystemPrompt(language) },
        { role: "user", content: buildDailyUserPrompt(dateLabel, lines) }
      ],
      2000
    );

    let embeddingJson: string | null = null;
    let embedded = false;
    if (!options.skipEmbedding) {
      const emb = embeddingConfigFromSettings(settings);
      if (emb) {
        try {
          const [vector] = await embedTexts(emb, [content.slice(0, 8000)]);
          embeddingJson = JSON.stringify(vector);
          embedded = true;
        } catch {
          // Embedding is best-effort in v0.1
          embedded = false;
        }
      }
    }

    const entry: MemoryEntry = {
      id: randomUUID(),
      level: "daily",
      periodStartMs: startMs,
      periodEndMs: endMs,
      title: `Daily · ${dateLabel}`,
      content,
      embeddingJson,
      createdAtMs: Date.now()
    };

    await insertMemoryEntry(
      dbPath,
      entry,
      sessions.map((s) => ({
        provider: s.provider,
        agentSessionId: s.id,
        projectPath: s.projectPath
      }))
    );

    await upsertMemoryJob(dbPath, jobKey, "ok");
    return { entry, sessionCount: sessions.length, jobKey, embedded };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await upsertMemoryJob(dbPath, jobKey, "error", message);
    throw error;
  }
}
