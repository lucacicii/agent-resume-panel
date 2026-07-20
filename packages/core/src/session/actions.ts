import { hideSessionsInCatalog, setSessionSummaryInCatalog, setUserTitleInCatalog } from "../catalog/mutations";
import { hideProjectInCatalog } from "../catalog/projects";
import { getSessionById } from "../catalog/query";
import { ensureExtensionCatalogSchema } from "../catalog/db";
import { AgentProvider, AgentSession } from "../catalog/types";
import { preparePanelDatabasesFromSettings } from "../dbPaths";
import { DEFAULT_CATALOG_OUTPUT_LANGUAGE } from "../i18n/outputLanguage";
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
  /** OS / VS Code display locale when output language is auto. */
  systemLocale?: string;
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

export interface SuggestSessionRenameResult {
  title: string;
  previousTitle: string;
}

async function loadSessionContext(opts: SessionActionOptions) {
  const settings = await loadSettings();
  const paths = await preparePanelDatabasesFromSettings();
  const catalogDb = paths.catalogDb;
  const desktopDb = paths.desktopDb;
  await ensureExtensionCatalogSchema(catalogDb);
  const session = await getSessionById(catalogDb, opts.provider, opts.id);
  if (!session) {
    throw new Error(`Session not found: ${opts.provider} ${opts.id}`);
  }
  const llm = llmConfigFromSettings(settings, opts.systemLocale);
  if (!llm) {
    throw new Error("LLM is not configured. Open Settings to set API base URL, model, and API key.");
  }
  const homes = resolvePreviewHomes(settings);
  const preview = await loadSessionPreview(session, homes);
  if (!preview.messages?.length) {
    throw new Error(preview.warning || "Session has no messages to analyze.");
  }
  return { settings, catalogDb, desktopDb, session, llm, homes, preview };
}

/** Summarize session transcript via LLM and cache on the catalog row. */
export async function summarizeSessionAction(
  opts: SessionActionOptions
): Promise<SummarizeSessionResult> {
  const { catalogDb, desktopDb, session, llm, preview } = await loadSessionContext(opts);
  const language = llm.outputLanguage?.trim() || DEFAULT_CATALOG_OUTPUT_LANGUAGE;

  try {
    const result = await summarizeSessionMessages(llm, preview.messages);
    await recordLlmUsage(desktopDb, {
      kind: "chat",
      source: "summarize",
      jobKey: `summarize:${session.provider}:${session.id}`,
      model: result.model,
      usage: result.usage,
      durationMs: result.durationMs,
      ok: true
    });
    await setSessionSummaryInCatalog(catalogDb, session.provider, session.id, language, result.summary);
    return {
      summary: result.summary,
      language,
      session: { ...session, sessionSummary: result.summary }
    };
  } catch (error) {
    await recordLlmUsage(desktopDb, {
      kind: "chat",
      source: "summarize",
      jobKey: `summarize:${session.provider}:${session.id}`,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }).catch(() => undefined);
    throw error;
  }
}

/** Suggest a session title via LLM without persisting changes. */
export async function suggestSessionRenameAction(
  opts: SessionActionOptions
): Promise<SuggestSessionRenameResult> {
  const result = await autoRenameSessionAction({ ...opts, persist: false });
  return { title: result.title, previousTitle: result.previousTitle };
}

/**
 * Suggest a title via LLM, update catalog user_title, then push to native agent store.
 * Catalog update always runs first (display title). Native failures are reported but do not roll back.
 * Set `persist: false` to only return a suggested title without saving.
 */
export async function autoRenameSessionAction(
  opts: SessionActionOptions & { persist?: boolean }
): Promise<AutoRenameSessionResult> {
  const persist = opts.persist !== false;
  const { catalogDb, desktopDb, session, llm, homes, preview } = await loadSessionContext(opts);
  const previousTitle = session.title;

  try {
    const result = await suggestSessionTitleFromMessages(llm, session.title, preview.messages);
    await recordLlmUsage(desktopDb, {
      kind: "chat",
      source: "rename",
      jobKey: `${persist ? "rename" : "rename-suggest"}:${session.provider}:${session.id}`,
      model: result.model,
      usage: result.usage,
      durationMs: result.durationMs,
      ok: true
    });

    if (!persist) {
      return {
        title: result.title,
        previousTitle,
        session,
        nativeRenamed: false
      };
    }

    if (session.provider !== "chat") {
      await setUserTitleInCatalog(catalogDb, session.provider, session.id, result.title);
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
    await recordLlmUsage(desktopDb, {
      kind: "chat",
      source: "rename",
      jobKey: `rename:${session.provider}:${session.id}`,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }).catch(() => undefined);
    throw error;
  }
}

export interface RenameSessionResult {
  session: AgentSession;
  nativeRenamed: boolean;
  nativeError?: string;
}

/** Manual rename: update catalog title, then push to native agent store. */
export async function renameSessionAction(
  opts: SessionActionOptions & { title: string }
): Promise<RenameSessionResult> {
  const title = opts.title.trim();
  if (!title) {
    throw new Error("Session title cannot be empty.");
  }

  const settings = await loadSettings();
  const dbPath = catalogDbFromSettings(settings);
  await ensureExtensionCatalogSchema(dbPath);
  const session = await getSessionById(dbPath, opts.provider, opts.id);
  if (!session) {
    throw new Error(`Session not found: ${opts.provider} ${opts.id}`);
  }
  const homes = resolvePreviewHomes(settings);

  if (session.provider !== "chat") {
    await setUserTitleInCatalog(dbPath, session.provider, session.id, title);
  }

  let nativeRenamed = false;
  let nativeError: string | undefined;
  try {
    await renameSessionNative(session, title, homes);
    nativeRenamed = true;
  } catch (error) {
    nativeError = error instanceof Error ? error.message : String(error);
    if (session.provider === "chat") {
      throw error;
    }
  }

  return {
    session: { ...session, title },
    nativeRenamed,
    nativeError
  };
}

export async function hideSessionAction(opts: SessionActionOptions): Promise<void> {
  const settings = await loadSettings();
  const dbPath = catalogDbFromSettings(settings);
  await ensureExtensionCatalogSchema(dbPath);
  const session = await getSessionById(dbPath, opts.provider, opts.id);
  if (!session) {
    throw new Error(`Session not found: ${opts.provider} ${opts.id}`);
  }
  await hideSessionsInCatalog(dbPath, [session]);
}

export async function hideProjectAction(opts: {
  projectId?: string;
  projectPath?: string;
}): Promise<{ projectId: string; hiddenSessions: number }> {
  const settings = await loadSettings();
  const dbPath = catalogDbFromSettings(settings);
  await ensureExtensionCatalogSchema(dbPath);
  const key = opts.projectId?.trim() || opts.projectPath?.trim();
  if (!key) {
    throw new Error("projectId or projectPath is required.");
  }
  return hideProjectInCatalog(dbPath, key);
}
