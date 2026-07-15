import { setSessionSummaryInCatalog } from "../catalog/mutations";
import { AgentSession } from "../catalog/types";
import { preparePanelDatabasesFromSettings } from "../dbPaths";
import { DigestProgressCallback, sessionProgressRef } from "../report/progress";
import { llmConfigFromSettings } from "../llm/fromSettings";
import { LlmRuntimeConfig } from "../llm/types";
import { PanelSettings } from "../settings/types";
import { resolvePreviewHomes } from "../transcript/homes";
import { loadSessionPreview } from "../transcript/load";
import { PreviewHomes } from "../transcript/types";
import { recordLlmUsage } from "../usage/store";
import { summarizeSessionMessages } from "./assist";

export interface EnsureSummariesOptions {
  dbPath: string;
  sessions: AgentSession[];
  settings: PanelSettings;
  /** Re-run summarize even when session_summary already exists. Default false. */
  force?: boolean;
  /** Parallel LLM calls. Default 2. */
  concurrency?: number;
  /** Optional panel home hint for agent homes resolution. */
  panelHome?: string;
  /** Prefix for usage job keys. */
  jobKeyPrefix?: string;
  /** Progress for UI (session-level). */
  onProgress?: DigestProgressCallback;
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
  const llmConfig = llmConfigFromSettings(options.settings);
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
  const language = llm.outputLanguage?.trim() || "zh-CN";
  const force = options.force === true;
  const prefix = options.jobKeyPrefix || "summarize";
  const level = options.progressLevel || "daily";
  const periodLabel = options.progressPeriodLabel || "";
  const onProgress = options.onProgress;

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
      message: `准备 summarize ${total} 个 session…`,
      index: 0,
      total
    });
  }

  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < out.length) {
      const index = cursor++;
      const session = out[index];
      const key = `${session.provider}:${session.id}`;
      const ref = sessionProgressRef(session);

      if (!force && session.sessionSummary?.trim()) {
        skipped += 1;
        processed += 1;
        onProgress?.({
          phase: "session_skip",
          level,
          periodLabel,
          message: `跳过（已有 summary）· ${session.title}`,
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
        message: `正在生成摘要 · ${session.title}`,
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
          jobKey: `${prefix}:${key}`
        });
        out[index] = { ...session, sessionSummary: summary };
        summarized += 1;
        processed += 1;
        onProgress?.({
          phase: "session_done",
          level,
          periodLabel,
          message: `摘要完成 · ${session.title}`,
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
          message: `摘要失败 · ${session.title}`,
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
