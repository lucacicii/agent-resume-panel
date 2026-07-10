import { setSessionSummaryInCatalog, setUserTitleInCatalog } from "../catalog/mutations";
import { getSessionById } from "../catalog/query";
import { ensureCatalogSchema } from "../catalog/db";
import { AgentProvider, AgentSession } from "../catalog/types";
import { llmConfigFromSettings } from "../llm/fromSettings";
import { catalogDbFromSettings, loadSettings } from "../settings/store";
import { loadSessionPreview } from "../transcript/load";
import { resolvePreviewHomes } from "../transcript/homes";
import { recordLlmUsage } from "../usage/store";
import { suggestSessionTitleFromMessages, summarizeSessionMessages } from "./assist";
import { renameSessionNative } from "./rename";

export interface SessionActionOptions {
  provider: AgentProvider;
  id: string;
}

export interface SummarizeSessionResult {
  summary: string;
  language: string;
  session: AgentSession;
}

export interface AutoRenameSessionResult {
  title: string;
  previousTitle: string;
  session: AgentSession;
  nativeRenamed: boolean;
  nativeError?: string;
}

async function loadSessionContext(opts: SessionActionOptions) {
  const settings = await loadSettings();
  const dbPath = catalogDbFromSettings(settings);
  await ensureCatalogSchema(dbPath);
  const session = await getSessionById(dbPath, opts.provider, opts.id);
  if (!session) {
    throw new Error(`Session not found: ${opts.provider} ${opts.id}`);
  }
  const llm = llmConfigFromSettings(settings);
  if (!llm) {
    throw new Error("LLM is not configured. Open Settings to set API base URL, model, and API key.");
  }
  const homes = resolvePreviewHomes(settings);
  const preview = await loadSessionPreview(session, homes);
  if (!preview.messages?.length) {
    throw new Error(preview.warning || "Session has no messages to analyze.");
  }
  return { settings, dbPath, session, llm, homes, preview };
}

/** Summarize session transcript via LLM and cache on the catalog row. */
export async function summarizeSessionAction(
  opts: SessionActionOptions
): Promise<SummarizeSessionResult> {
  const { dbPath, session, llm, preview } = await loadSessionContext(opts);
  const language = llm.outputLanguage?.trim() || "zh-CN";

  try {
    const result = await summarizeSessionMessages(llm, preview.messages);
    await recordLlmUsage(dbPath, {
      kind: "chat",
      source: "summarize",
      jobKey: `summarize:${session.provider}:${session.id}`,
      model: result.model,
      usage: result.usage,
      durationMs: result.durationMs,
      ok: true
    });
    await setSessionSummaryInCatalog(dbPath, session.provider, session.id, language, result.summary);
    return {
      summary: result.summary,
      language,
      session: { ...session, sessionSummary: result.summary }
    };
  } catch (error) {
    await recordLlmUsage(dbPath, {
      kind: "chat",
      source: "summarize",
      jobKey: `summarize:${session.provider}:${session.id}`,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }).catch(() => undefined);
    throw error;
  }
}

/**
 * Suggest a title via LLM, update catalog user_title, then push to native agent store.
 * Catalog update always runs first (display title). Native failures are reported but do not roll back.
 */
export async function autoRenameSessionAction(
  opts: SessionActionOptions
): Promise<AutoRenameSessionResult> {
  const { dbPath, session, llm, homes, preview } = await loadSessionContext(opts);
  const previousTitle = session.title;

  try {
    const result = await suggestSessionTitleFromMessages(llm, session.title, preview.messages);
    await recordLlmUsage(dbPath, {
      kind: "chat",
      source: "rename",
      jobKey: `rename:${session.provider}:${session.id}`,
      model: result.model,
      usage: result.usage,
      durationMs: result.durationMs,
      ok: true
    });

    if (session.provider !== "chat") {
      await setUserTitleInCatalog(dbPath, session.provider, session.id, result.title);
    }

    let nativeRenamed = false;
    let nativeError: string | undefined;
    try {
      await renameSessionNative(session, result.title, homes);
      nativeRenamed = true;
    } catch (error) {
      nativeError = error instanceof Error ? error.message : String(error);
      // Catalog title still updated for non-chat; surface native failure to caller.
      if (session.provider === "chat") {
        throw error;
      }
    }

    return {
      title: result.title,
      previousTitle,
      session: { ...session, title: result.title },
      nativeRenamed,
      nativeError
    };
  } catch (error) {
    await recordLlmUsage(dbPath, {
      kind: "chat",
      source: "rename",
      jobKey: `rename:${session.provider}:${session.id}`,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }).catch(() => undefined);
    throw error;
  }
}
