import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { SearchDocType } from "@agent-resume/core/extension";
import { AcpChatManager } from "../acp/acpChatManager";
import { getAcpRecord } from "../acp/store";
import {
  CatalogProjectGroupSummary,
  loadCatalogSettings,
  queryGtdCountsFromCatalog,
  queryProjectGroupSummaries,
  queryVisibleSessionCount,
  removeSessionsFromPanel,
  resolveSessionById
} from "../catalog";
import { t } from "../i18n";
import { getSessionPreviewUiStrings, getSessionSearchUiStrings } from "../webview/uiStrings";
import { truncateText } from "../util/dialogText";
import { AgentProvider, AgentSession, compactPath } from "../history";
import { loadRenameHomes } from "../history/rename/homes";
import { renameSessionWithCatalog } from "../catalog/rename";
import { loadSessionPreview } from "../history/preview";
import { getLlmConfig, isLlmConfigured } from "../llm/config";
import { getCachedSummary } from "../llm/summaryCache";
import { pickResumeTarget, resumeSession } from "../preview/resumeActions";
import { canHandoffSession, runContinueWithAgent } from "../preview/handoffActions";
import { runAutoRename, runSummarize } from "../preview/sessionAssistActions";
import { openSettingsPanelToLlm } from "../settings/settingsPanel";
import { LLM_API_KEY_SECRET } from "../settings/settingsSchema";
import { openSessionResume } from "../terminal/resumeTerminal";
import { GTD_STATUSES } from "../catalog/gtd";
import { gtdStatusLabel } from "../gtd/gtdTree";
import { SessionTreeProvider } from "../tree/sessionTree";
import { getPreviewRenderMode, setPreviewRenderMode } from "../preview/previewRenderMode";
import { buildWebviewAgentIconMap } from "../icons/agentIcons";
import {
  loadAcpChatPreview,
  queryUnifiedSearchForPanel,
  syncUnifiedSearchIndexNow,
  UNIFIED_SEARCH_PAGE_SIZE
} from "./unifiedSearch";

const WEBVIEW_ASSET_VERSION = "11";

interface SearchProjectPayload {
  projectPath: string;
  name: string;
  sessionCount: number;
  favorited: boolean;
  compactPath: string;
  latestUpdatedAt: number;
}

interface WebviewMessage {
  type?: string;
  provider?: AgentProvider;
  id?: string;
  relMdPath?: string;
  column?: SearchDocType | "all";
  offset?: number;
  sessionsOffset?: number;
  acpOffset?: number;
  notesOffset?: number;
  limit?: number;
  search?: string;
  projectPath?: string | null;
  gtdFilter?: string | null;
  mode?: unknown;
}

let searchPanel: vscode.WebviewPanel | undefined;
let activeSearchContext: vscode.ExtensionContext | undefined;
let activeSearchTree: SessionTreeProvider | undefined;
let activeSearchPreview: { provider: AgentProvider; id: string } | undefined;
let llmConfigRefreshRegistered = false;
let cachedSearchProjectGroups: CatalogProjectGroupSummary[] = [];

export async function searchAndOpenSessions(
  context: vscode.ExtensionContext,
  tree: SessionTreeProvider,
  refreshTree: () => Promise<void>,
  acpChatManager: AcpChatManager
): Promise<void> {
  const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

  if (searchPanel) {
    activeSearchContext = context;
    activeSearchTree = tree;
    searchPanel.title = t("panel.searchSessionsTitle");
    searchPanel.reveal(column);
    void postInitMessage(searchPanel.webview, tree);
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    "agentResume.searchSessions",
    t("panel.searchSessionsTitle"),
    column,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: getLocalResourceRoots()
    }
  );

  attachSearchPanel(panel, context, tree, refreshTree, acpChatManager);
}

export async function restoreSearchSessionsPanel(
  panel: vscode.WebviewPanel,
  context: vscode.ExtensionContext,
  tree: SessionTreeProvider,
  refreshTree: () => Promise<void>,
  acpChatManager: AcpChatManager
): Promise<void> {
  if (searchPanel) {
    panel.dispose();
    return;
  }

  panel.title = t("panel.searchSessionsTitle");
  panel.webview.options = {
    enableScripts: true,
    localResourceRoots: getLocalResourceRoots()
  };
  attachSearchPanel(panel, context, tree, refreshTree, acpChatManager);
}

function attachSearchPanel(
  panel: vscode.WebviewPanel,
  context: vscode.ExtensionContext,
  tree: SessionTreeProvider,
  refreshTree: () => Promise<void>,
  acpChatManager: AcpChatManager
): void {
  searchPanel = panel;
  activeSearchContext = context;
  activeSearchTree = tree;
  registerLlmConfigRefresh(context);
  searchPanel.iconPath = vscode.Uri.joinPath(getExtensionUri(), "resources", "agent-resume.svg");
  searchPanel.webview.html = getWebviewHtml(searchPanel.webview);

  searchPanel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
    if (message.type === "ready") {
      await postInitMessage(searchPanel!.webview, tree);
      return;
    }

    if (message.type === "queryPage") {
      await handleQueryPageMessage(searchPanel!.webview, tree, message);
      return;
    }

    if (message.type === "syncIndex") {
      await runBackgroundIndexSync(searchPanel!.webview, true);
      return;
    }

    if (message.type === "openAcp" && message.id) {
      await handleOpenAcpMessage(context, tree, searchPanel!.webview, acpChatManager, message.id);
      return;
    }

    if (message.type === "openNote") {
      await handleOpenNoteMessage(message.id, message.relMdPath);
      return;
    }

    if (message.type === "resume" && message.provider && message.id) {
      if (message.provider === "chat") {
        await handleOpenAcpMessage(context, tree, searchPanel!.webview, acpChatManager, message.id);
        return;
      }
      const session = await findSession(tree, message.provider, message.id);
      if (session) {
        openSessionResume(session, context);
      }
      return;
    }

    if (message.type === "rename" && message.provider && message.id) {
      await handleRenameMessage(tree, searchPanel!.webview, refreshTree, message.provider, message.id);
      return;
    }

    if (message.type === "remove" && message.provider && message.id) {
      await handleRemoveMessage(tree, searchPanel!.webview, refreshTree, message.provider, message.id);
      return;
    }

    if (message.type === "preview" && message.provider && message.id) {
      await handlePreviewMessage(context, tree, searchPanel!.webview, message.provider, message.id);
      return;
    }

    if (message.type === "previewResume" && message.provider && message.id) {
      if (message.provider === "chat") {
        await handleOpenAcpMessage(context, tree, searchPanel!.webview, acpChatManager, message.id);
        return;
      }
      const session = await findSession(tree, message.provider, message.id);
      if (session) {
        await resumeSession(session, "vscode", context);
      }
      return;
    }

    if (message.type === "previewResumeWith" && message.provider && message.id) {
      const session = await findSession(tree, message.provider, message.id);
      if (!session || session.provider === "chat") {
        return;
      }

      const target = await pickResumeTarget(session);
      if (target) {
        await resumeSession(session, target, context);
      }
      return;
    }

    if (message.type === "summarize" && message.provider && message.id) {
      const session = await findSession(tree, message.provider, message.id);
      if (session) {
        await runSummarize(session, context, searchPanel!.webview, tree);
      }
      return;
    }

    if (message.type === "autoRename" && message.provider && message.id) {
      const session = await findSession(tree, message.provider, message.id);
      if (session) {
        await runAutoRename(session, tree, refreshTree, context, {
          webview: searchPanel!.webview
        });
      }
      return;
    }

    if (message.type === "continueWithAgent" && message.provider && message.id) {
      const session = await findSession(tree, message.provider, message.id);
      if (session) {
        await runContinueWithAgent(session, context, acpChatManager, searchPanel!.webview);
      }
      return;
    }

    if (message.type === "openLlmSettings") {
      await openSettingsPanelToLlm(context);
      return;
    }

    if (message.type === "setPreviewRenderMode") {
      await setPreviewRenderMode(activeSearchContext, message.mode);
      return;
    }

    if (message.type === "previewClosed") {
      activeSearchPreview = undefined;
    }
  });

  searchPanel.onDidDispose(() => {
    searchPanel = undefined;
    activeSearchContext = undefined;
    activeSearchTree = undefined;
    activeSearchPreview = undefined;
  });
}

async function handleOpenAcpMessage(
  context: vscode.ExtensionContext,
  tree: SessionTreeProvider,
  webview: vscode.Webview,
  acpChatManager: AcpChatManager,
  chatId: string
): Promise<void> {
  const homes = loadRenameHomes();
  const record = await getAcpRecord(homes.panelHome, chatId);
  if (record) {
    acpChatManager.open(record);
    return;
  }
  // Legacy proxy chats without an acp/sessions.jsonl record fall back to preview.
  await handlePreviewMessage(context, tree, webview, "chat", chatId);
}

async function handleOpenNoteMessage(noteId?: string, relMdPath?: string): Promise<void> {
  const homes = loadRenameHomes();
  const targetRel = relMdPath?.trim();
  if (!targetRel) {
    if (noteId) {
      vscode.window.showWarningMessage(`Note path unavailable (${noteId}).`);
    }
    return;
  }
  const absPath = path.join(homes.panelHome, targetRel);
  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(absPath));
    await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.Beside,
      preview: false
    });
  } catch (error) {
    vscode.window.showErrorMessage(formatError(error));
  }
}

function registerLlmConfigRefresh(context: vscode.ExtensionContext): void {
  if (llmConfigRefreshRegistered) {
    return;
  }

  llmConfigRefreshRegistered = true;
  context.subscriptions.push(
    context.secrets.onDidChange((event) => {
      if (event.key === LLM_API_KEY_SECRET) {
        void refreshActiveSearchPreview();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("agentResume.llm")) {
        void refreshActiveSearchPreview();
      }
    })
  );
}

async function refreshActiveSearchPreview(): Promise<void> {
  if (!searchPanel || !activeSearchContext || !activeSearchTree || !activeSearchPreview) {
    return;
  }

  await handlePreviewMessage(
    activeSearchContext,
    activeSearchTree,
    searchPanel.webview,
    activeSearchPreview.provider,
    activeSearchPreview.id
  );
}

async function handlePreviewMessage(
  context: vscode.ExtensionContext,
  tree: SessionTreeProvider,
  webview: vscode.Webview,
  provider: AgentProvider,
  id: string
): Promise<void> {
  const session = await findSession(tree, provider, id);
  if (!session) {
    return;
  }

  activeSearchPreview = { provider, id };
  webview.postMessage({ type: "previewLoading", provider, id });

  try {
    const preview =
      provider === "chat"
        ? await loadAcpChatPreview(id, session.title)
        : await loadSessionPreview(session, loadRenameHomes());
    const llmConfigured = await isLlmConfigured(context);
    const llmConfig = await getLlmConfig(context);
    const cachedSummary = llmConfig
      ? await getCachedSummary(context, session, llmConfig.outputLanguage)
      : undefined;
    webview.postMessage({
      type: "previewResult",
      provider,
      id,
      showResumeWith: provider !== "chat",
      showHandoff: provider !== "chat" && canHandoffSession(session),
      llmConfigured,
      renderMode: getPreviewRenderMode(context),
      cachedSummary,
      title: preview.title,
      messages: preview.messages,
      truncated: preview.truncated,
      warning: preview.warning
    });
  } catch (error) {
    webview.postMessage({
      type: "previewResult",
      provider,
      id,
      error: formatError(error)
    });
    vscode.window.showErrorMessage(t("notification.previewFailed", formatError(error)));
  }
}

async function handleRemoveMessage(
  tree: SessionTreeProvider,
  webview: vscode.Webview,
  refreshTree: () => Promise<void>,
  provider: AgentProvider,
  id: string
): Promise<void> {
  const session = await findSession(tree, provider, id);
  if (!session || session.provider === "chat") {
    return;
  }

  const removeButton = t("dialog.buttonRemove");
  const confirm = await vscode.window.showWarningMessage(
    t("dialog.removeFromPanelConfirm", truncateText(session.title, 48), session.provider),
    { modal: true },
    removeButton
  );
  if (confirm !== removeButton) {
    return;
  }

  try {
    const catalog = loadCatalogSettings();
    await removeSessionsFromPanel(catalog.dbPath, [session]);
    await refreshTree();
    await syncUnifiedSearchIndexNow().catch(() => undefined);
    await postInitMessage(webview, tree);
    vscode.window.showInformationMessage(t("notification.sessionRemovedFromPanel"));
  } catch (error) {
    vscode.window.showErrorMessage(t("notification.removeFailed", formatError(error)));
  }
}

async function handleRenameMessage(
  tree: SessionTreeProvider,
  webview: vscode.Webview,
  refreshTree: () => Promise<void>,
  provider: AgentProvider,
  id: string
): Promise<void> {
  const session = await findSession(tree, provider, id);
  if (!session) {
    webview.postMessage({ type: "renameDone" });
    return;
  }

  const newTitle = await vscode.window.showInputBox({
    title: t("dialog.renameSessionTitle"),
    prompt: t("dialog.renameSessionPrompt"),
    value: session.title,
    validateInput: (value) => (value.trim() ? undefined : t("dialog.renameSessionValidateEmpty"))
  });

  if (!newTitle) {
    webview.postMessage({ type: "renameDone" });
    return;
  }

  try {
    await renameSessionWithCatalog(session, newTitle, loadRenameHomes());
    await refreshTree();
    await syncUnifiedSearchIndexNow().catch(() => undefined);
    await postInitMessage(webview, tree);
    vscode.window.showInformationMessage(t("notification.sessionRenamed"));
  } catch (error) {
    webview.postMessage({ type: "renameDone" });
    vscode.window.showErrorMessage(t("notification.renameFailed", formatError(error)));
  }
}

async function findSession(
  tree: SessionTreeProvider,
  provider: AgentProvider,
  id: string
): Promise<AgentSession | undefined> {
  return resolveSessionById(tree, provider, id);
}

async function postInitMessage(webview: vscode.Webview, tree: SessionTreeProvider): Promise<void> {
  const catalog = loadCatalogSettings();
  const favoriteProjects = tree.getFavoriteProjects();
  const [projectGroups, totalSessions, gtdCounts, initialSearch] = await Promise.all([
    queryProjectGroupSummaries(catalog.dbPath, favoriteProjects),
    queryVisibleSessionCount(catalog.dbPath),
    queryGtdCountsFromCatalog(catalog.dbPath),
    queryUnifiedSearchForPanel(tree, { limit: UNIFIED_SEARCH_PAGE_SIZE })
  ]);
  cachedSearchProjectGroups = projectGroups;
  const taggedCount = GTD_STATUSES.reduce((sum, status) => sum + (gtdCounts[status] ?? 0), 0);

  const payload = {
    type: "init",
    uiStrings: getSessionSearchUiStrings(),
    previewUiStrings: getSessionPreviewUiStrings(),
    providerIcons: buildWebviewAgentIconMap(webview, getExtensionUri()),
    totalSessions,
    untaggedCount: Math.max(0, totalSessions - taggedCount),
    projects: projectGroups.map(
      (project): SearchProjectPayload => ({
        projectPath: path.resolve(project.projectPath),
        name: tree.getProjectDisplayName(project.projectPath),
        sessionCount: project.sessionCount,
        favorited: Boolean(project.favorited),
        compactPath: compactPath(project.projectPath),
        latestUpdatedAt: project.latestUpdatedAt
      })
    ),
    sessions: initialSearch.sessions,
    acp: initialSearch.acp,
    notes: initialSearch.notes,
    indexedCounts: initialSearch.indexedCounts,
    queryTimeMs: initialSearch.queryTimeMs,
    usingFallback: Boolean(initialSearch.usingFallback),
    gtdStatuses: GTD_STATUSES.map((status) => ({
      status,
      label: gtdStatusLabel(status),
      count: gtdCounts[status] ?? 0
    }))
  };

  webview.postMessage(payload);

  // Kick off incremental full-text index sync in background without blocking initial render.
  void runBackgroundIndexSync(webview, Boolean(initialSearch.usingFallback));
}

async function runBackgroundIndexSync(
  webview: vscode.Webview,
  forceRefreshResults: boolean
): Promise<void> {
  webview.postMessage({ type: "indexSyncing" });
  try {
    const stats = await syncUnifiedSearchIndexNow();
    if (searchPanel && searchPanel.webview === webview) {
      webview.postMessage({
        type: "indexSynced",
        stats,
        shouldRefresh: forceRefreshResults || stats.updatedDocs > 0 || stats.deletedDocs > 0
      });
    }
  } catch (error) {
    if (searchPanel && searchPanel.webview === webview) {
      webview.postMessage({
        type: "indexSyncError",
        error: formatError(error)
      });
    }
  }
}

async function handleQueryPageMessage(
  webview: vscode.Webview,
  tree: SessionTreeProvider,
  message: WebviewMessage
): Promise<void> {
  const limit = Math.max(
    1,
    Math.min(Math.floor(message.limit ?? UNIFIED_SEARCH_PAGE_SIZE), 150)
  );
  const projectPath = message.projectPath?.trim() || undefined;
  const matchedGroup = projectPath
    ? cachedSearchProjectGroups.find((g) => path.resolve(g.projectPath) === path.resolve(projectPath))
    : undefined;

  const column = message.column;
  const columns: SearchDocType[] | undefined =
    column === "session" || column === "acp" || column === "note" ? [column] : undefined;

  const sessionsOffset =
    column === "session"
      ? Math.max(0, Math.floor(message.offset ?? message.sessionsOffset ?? 0))
      : Math.max(0, Math.floor(message.sessionsOffset ?? 0));
  const acpOffset =
    column === "acp"
      ? Math.max(0, Math.floor(message.offset ?? message.acpOffset ?? 0))
      : Math.max(0, Math.floor(message.acpOffset ?? 0));
  const notesOffset =
    column === "note"
      ? Math.max(0, Math.floor(message.offset ?? message.notesOffset ?? 0))
      : Math.max(0, Math.floor(message.notesOffset ?? 0));

  const res = await queryUnifiedSearchForPanel(tree, {
    query: message.search,
    matchedGroup,
    projectPath,
    gtdFilter: message.gtdFilter,
    columns,
    sessionsOffset,
    acpOffset,
    notesOffset,
    limit
  });

  webview.postMessage({
    type: "pageResult",
    column: column ?? "all",
    append: Boolean(columns && (message.offset ?? 0) > 0),
    sessions: res.sessions,
    acp: res.acp,
    notes: res.notes,
    indexedCounts: res.indexedCounts,
    queryTimeMs: res.queryTimeMs,
    usingFallback: Boolean(res.usingFallback)
  });
}

function getWebviewHtml(webview: vscode.Webview): string {
  const extensionUri = getExtensionUri();
  const htmlUri = vscode.Uri.joinPath(extensionUri, "media", "sessionSearch.html");
  const styleUri = webview
    .asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "sessionSearch.css"))
    .with({ query: WEBVIEW_ASSET_VERSION });
  const markdownStyleUri = webview
    .asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "previewMarkdown.css"))
    .with({ query: WEBVIEW_ASSET_VERSION });
  const markedUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "node_modules", "marked", "lib", "marked.umd.js")
  );
  const purifyUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "node_modules", "dompurify", "dist", "purify.min.js")
  );
  const markdownScriptUri = webview
    .asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "previewMarkdown.js"))
    .with({ query: WEBVIEW_ASSET_VERSION });
  const scriptUri = webview
    .asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "sessionSearch.js"))
    .with({ query: WEBVIEW_ASSET_VERSION });
  const nonce = getNonce();

  let html = readMediaFile(htmlUri.fsPath);
  html = html
    .replaceAll("{{cspSource}}", webview.cspSource)
    .replaceAll("{{nonce}}", nonce)
    .replaceAll("{{styleUri}}", styleUri.toString())
    .replaceAll("{{markdownStyleUri}}", markdownStyleUri.toString())
    .replaceAll("{{markedUri}}", markedUri.toString())
    .replaceAll("{{purifyUri}}", purifyUri.toString())
    .replaceAll("{{markdownScriptUri}}", markdownScriptUri.toString())
    .replaceAll("{{scriptUri}}", scriptUri.toString());

  return html;
}

function getLocalResourceRoots(): vscode.Uri[] {
  const extensionUri = getExtensionUri();
  return [
    vscode.Uri.joinPath(extensionUri, "media"),
    vscode.Uri.joinPath(extensionUri, "resources", "agents"),
    vscode.Uri.joinPath(extensionUri, "node_modules", "marked"),
    vscode.Uri.joinPath(extensionUri, "node_modules", "dompurify")
  ];
}

function getExtensionUri(): vscode.Uri {
  return vscode.Uri.file(path.join(__dirname, "..", ".."));
}

function readMediaFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

export async function refreshSessionSearchPanel(): Promise<void> {
  if (!searchPanel || !activeSearchTree) {
    return;
  }

  searchPanel.title = t("panel.searchSessionsTitle");
  await postInitMessage(searchPanel.webview, activeSearchTree);
}

export function notifySearchPanelIndexUpdated(): void {
  if (!searchPanel) {
    return;
  }
  searchPanel.webview.postMessage({
    type: "indexSynced",
    shouldRefresh: true
  });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
