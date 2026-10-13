import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { AcpChatManager } from "../acp/acpChatManager";
import {
  CatalogProjectGroupSummary,
  loadCatalogSettings,
  queryFilteredSessionsPage,
  queryGtdCountsFromCatalog,
  queryProjectGroupSummaries,
  queryVisibleSessionCount,
  removeSessionsFromPanel,
  resolveSessionById
} from "../catalog";
import { t } from "../i18n";
import { getSessionPreviewUiStrings, getSessionSearchUiStrings } from "../webview/uiStrings";
import { truncateText } from "../util/dialogText";
import { AgentProvider, AgentSession } from "../history";
import { compactPath } from "../history";
import { loadRenameHomes } from "../history/rename/homes";
import { renameSessionWithCatalog } from "../catalog/rename";
import { loadSessionPreview } from "../history/preview";
import { getLlmConfig, getLlmOutputLanguage, isLlmConfigured } from "../llm/config";
import { getCachedSummary } from "../llm/summaryCache";
import { pickResumeTarget, resumeSession } from "../preview/resumeActions";
import { canHandoffSession, runContinueWithAgent } from "../preview/handoffActions";
import { runAutoRename, runSummarize } from "../preview/sessionAssistActions";
import { openSettingsPanelToLlm } from "../settings/settingsPanel";
import { LLM_API_KEY_SECRET } from "../settings/settingsSchema";
import { openSessionResume } from "../terminal/resumeTerminal";
import { GTD_STATUSES } from "../catalog/gtd";
import { gtdStatusLabel } from "../gtd/gtdTree";
import {
  enrichSearchSessionItem,
  enrichSessionsWithTreeSummaries,
  SessionTreeProvider
} from "../tree/sessionTree";

const SEARCH_PAGE_SIZE = 50;

const WEBVIEW_ASSET_VERSION = "3";

interface SearchProjectPayload {
  projectPath: string;
  name: string;
  sessionCount: number;
  favorited: boolean;
  compactPath: string;
}

interface WebviewMessage {
  type?: string;
  provider?: AgentProvider;
  id?: string;
  offset?: number;
  limit?: number;
  search?: string;
  projectPath?: string | null;
  gtdFilter?: string | null;
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

  searchPanel = vscode.window.createWebviewPanel(
    "agentResume.searchSessions",
    t("panel.searchSessionsTitle"),
    column,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(getExtensionUri(), "media")]
    }
  );

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

    if (message.type === "resume" && message.provider && message.id) {
      const session = await findSession(tree, message.provider, message.id);
      if (session) {
        searchPanel?.dispose();
        openSessionResume(session, undefined);
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
      const session = await findSession(tree, message.provider, message.id);
      if (session) {
        await resumeSession(session, "vscode", context);
      }
      return;
    }

    if (message.type === "previewResumeWith" && message.provider && message.id) {
      const session = await findSession(tree, message.provider, message.id);
      if (!session) {
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
    const preview = await loadSessionPreview(session, loadRenameHomes());
    const llmConfigured = await isLlmConfigured(context);
    const llmConfig = await getLlmConfig(context);
    const cachedSummary = llmConfig
      ? await getCachedSummary(context, session, llmConfig.outputLanguage)
      : undefined;
    webview.postMessage({
      type: "previewResult",
      provider,
      id,
      showResumeWith: true,
      showHandoff: canHandoffSession(session),
      llmConfigured,
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
    await postInitMessage(webview, tree);
    vscode.window.showInformationMessage(t("notification.sessionRenamed"));
  } catch (error) {
    webview.postMessage({ type: "renameDone" });
    vscode.window.showErrorMessage(t("notification.renameFailed", formatError(error)));
  }
}

async function findSession(tree: SessionTreeProvider, provider: AgentProvider, id: string): Promise<AgentSession | undefined> {
  return resolveSessionById(tree, provider, id);
}

async function postInitMessage(webview: vscode.Webview, tree: SessionTreeProvider): Promise<void> {
  const catalog = loadCatalogSettings();
  const outputLanguage = getLlmOutputLanguage();
  const favoriteProjects = tree.getFavoriteProjects();
  const [projectGroups, totalSessions, gtdCounts, firstPage] = await Promise.all([
    queryProjectGroupSummaries(catalog.dbPath, favoriteProjects),
    queryVisibleSessionCount(catalog.dbPath),
    queryGtdCountsFromCatalog(catalog.dbPath),
    queryFilteredSessionsPage(catalog.dbPath, {
      limit: SEARCH_PAGE_SIZE,
      offset: 0,
      outputLanguage,
      summaryPolicy: "any"
    })
  ]);
  cachedSearchProjectGroups = projectGroups;
  const enrichedFirstPage = enrichSessionsWithTreeSummaries(firstPage.sessions, tree.getSessions());
  const taggedCount = GTD_STATUSES.reduce((sum, status) => sum + (gtdCounts[status] ?? 0), 0);

  const payload = {
    type: "init",
    uiStrings: getSessionSearchUiStrings(),
    previewUiStrings: getSessionPreviewUiStrings(),
    totalSessions,
    untaggedCount: Math.max(0, totalSessions - taggedCount),
    filteredTotal: firstPage.total,
    hasMore: enrichedFirstPage.length < firstPage.total,
    projects: projectGroups.map(
      (project): SearchProjectPayload => ({
        projectPath: path.resolve(project.projectPath),
        name: tree.getProjectDisplayName(project.projectPath),
        sessionCount: project.sessionCount,
        favorited: Boolean(project.favorited),
        compactPath: compactPath(project.projectPath)
      })
    ),
    sessions: enrichedFirstPage.map((session) => enrichSearchSessionItem(session, tree)),
    gtdStatuses: GTD_STATUSES.map((status) => ({
      status,
      label: gtdStatusLabel(status),
      count: gtdCounts[status] ?? 0
    }))
  };

  webview.postMessage(payload);
}

async function handleQueryPageMessage(
  webview: vscode.Webview,
  tree: SessionTreeProvider,
  message: WebviewMessage
): Promise<void> {
  const catalog = loadCatalogSettings();
  const offset = Math.max(0, Math.floor(message.offset ?? 0));
  const limit = Math.max(1, Math.min(Math.floor(message.limit ?? SEARCH_PAGE_SIZE), 200));
  const projectPath = message.projectPath?.trim() || undefined;
  const matchedGroup = projectPath
    ? cachedSearchProjectGroups.find((g) => path.resolve(g.projectPath) === path.resolve(projectPath))
    : undefined;
  const page = await queryFilteredSessionsPage(catalog.dbPath, {
    limit,
    offset,
    search: message.search,
    projectPath,
    projectId: matchedGroup?.projectId,
    projectCandidatePaths: matchedGroup?.candidatePaths,
    gtdFilter: message.gtdFilter,
    outputLanguage: getLlmOutputLanguage(),
    summaryPolicy: "any"
  });
  const enriched = enrichSessionsWithTreeSummaries(page.sessions, tree.getSessions());
  webview.postMessage({
    type: "pageResult",
    offset,
    append: offset > 0,
    total: page.total,
    hasMore: offset + enriched.length < page.total,
    sessions: enriched.map((session) => enrichSearchSessionItem(session, tree))
  });
}

function getWebviewHtml(webview: vscode.Webview): string {
  const extensionUri = getExtensionUri();
  const htmlUri = vscode.Uri.joinPath(extensionUri, "media", "sessionSearch.html");
  const styleUri = webview
    .asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "sessionSearch.css"))
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
    .replaceAll("{{scriptUri}}", scriptUri.toString());

  return html;
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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}