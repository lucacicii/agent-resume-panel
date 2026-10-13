import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  loadCatalogSettings,
  queryFilteredSessionsPage,
  queryGtdCountsFromCatalog,
  queryManagerStats,
  querySessionById,
  syncCatalog
} from "../catalog";
import { resolveSessionById } from "../catalog/resolve";
import { AgentSession, HistoryLoadOptions } from "../history/types";
import { exportCatalogWithTranscripts } from "../catalog/transcript/export";
import { removeSessionsFromPanel } from "../catalog/mutations";
import { t } from "../i18n";
import { getSessionManagerUiStrings } from "../webview/uiStrings";
import { getLlmOutputLanguage } from "../llm/config";
import { openSessionResume } from "../terminal/resumeTerminal";
import { GTD_STATUSES } from "../catalog/gtd";
import { gtdStatusLabel } from "../gtd/gtdTree";
import {
  buildSessionSubtitle,
  enrichSearchSessionItem,
  enrichSessionsWithTreeSummaries,
  SessionTreeProvider
} from "../tree/sessionTree";
import { relativeTime } from "../util/relativeTime";

interface ManagerSessionPayload {
  provider: string;
  id: string;
  title: string;
  projectPath: string;
  projectName: string;
  updatedAtMs: number;
  updatedAtLabel: string;
  subtitle: string;
  gtdStatus?: string;
  gtdStatusLabel?: string;
}

interface ManagerStats {
  total: number;
  withSummary: number;
  byProvider: Record<string, number>;
}

const WEBVIEW_ASSET_VERSION = "6";
const MANAGER_PAGE_SIZE = 200;
let managerPanel: vscode.WebviewPanel | undefined;
let activeManagerTree: SessionTreeProvider | undefined;
let activeManagerBuildLoadOptions: (() => HistoryLoadOptions) | undefined;

export async function openSessionManagerPanel(
  context: vscode.ExtensionContext,
  tree: SessionTreeProvider,
  buildLoadOptions: () => HistoryLoadOptions,
  refreshTree: () => Promise<void>
): Promise<void> {
  const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
  if (managerPanel) {
    activeManagerTree = tree;
    activeManagerBuildLoadOptions = buildLoadOptions;
    managerPanel.title = t("panel.sessionManagerTitle");
    managerPanel.reveal(column);
    await postManagerInit(managerPanel.webview, tree, buildLoadOptions);
    return;
  }

  activeManagerTree = tree;
  activeManagerBuildLoadOptions = buildLoadOptions;

  managerPanel = vscode.window.createWebviewPanel(
    "agentResume.sessionManager",
    t("panel.sessionManagerTitle"),
    column,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")]
    }
  );

  managerPanel.iconPath = vscode.Uri.joinPath(context.extensionUri, "resources", "agent-resume.svg");

  managerPanel.webview.onDidReceiveMessage(async (message) => {
    if (message.type === "ready" || message.type === "resync") {
      await refreshTree();
      await postManagerInit(managerPanel!.webview, tree, buildLoadOptions);
      return;
    }

    if (message.type === "queryPage") {
      await handleManagerQueryPage(managerPanel!.webview, tree, message);
      return;
    }
    if (message.type === "remove" && Array.isArray(message.items)) {
      await handleRemoveFromPanel(message.items, buildLoadOptions, refreshTree);
      await postManagerInit(managerPanel!.webview, tree, buildLoadOptions);
      return;
    }

    if (message.type === "export") {
      await handleExportFromManager(message.items, refreshTree);
      return;
    }

    if (message.type === "resume" && message.provider && message.id) {
      const session = await resolveSessionById(tree, message.provider, message.id);
      if (session) {
        managerPanel?.dispose();
        openSessionResume(session, context);
      }
    }
  });

  managerPanel.onDidDispose(() => {
    managerPanel = undefined;
    activeManagerTree = undefined;
    activeManagerBuildLoadOptions = undefined;
  });

  managerPanel.webview.html = getWebviewHtml(managerPanel.webview, context.extensionUri);
  void postManagerInit(managerPanel.webview, tree, buildLoadOptions);
}

async function handleExportFromManager(
  items: Array<{ provider: AgentSession["provider"]; id: string }> | undefined,
  refreshTree: () => Promise<void>
): Promise<void> {
  const catalog = loadCatalogSettings();
  const folder = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: t("dialog.exportSelectFolderOpenLabel")
  });
  if (!folder?.[0]) {
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir = path.join(folder[0].fsPath, `agent-resume-catalog-${stamp}`);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: t("progress.exportingSessions"),
      cancellable: false
    },
    async () => {
      await refreshTree();
      const result = await exportCatalogWithTranscripts({
        dbPath: catalog.dbPath,
        outputDir,
        onlySessions: items?.length ? items : undefined
      });
      vscode.window.showInformationMessage(
        t(
          "notification.sessionManagerExported",
          result.sessionCount,
          result.transcriptFileCount,
          result.outputDir
        )
      );
    }
  );
}

async function handleRemoveFromPanel(
  items: Array<{ provider: AgentSession["provider"]; id: string }>,
  buildLoadOptions: () => HistoryLoadOptions,
  refreshTree: () => Promise<void>
): Promise<void> {
  const catalog = loadCatalogSettings();
  const sessions: AgentSession[] = [];
  for (const item of items) {
    const session = await querySessionById(catalog.dbPath, item.provider, item.id);
    if (session) {
      sessions.push(session);
    }
  }

  if (!sessions.length) {
    return;
  }

  const removeButton = t("dialog.buttonRemove");
  const confirm = await vscode.window.showWarningMessage(
    t("dialog.removeMultipleFromPanelConfirm", sessions.length),
    { modal: true },
    removeButton
  );
  if (confirm !== removeButton) {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: t("progress.removingSessionsFromPanel"),
      cancellable: false
    },
    async () => {
      await removeSessionsFromPanel(catalog.dbPath, sessions);
    }
  );

  await syncCatalog(buildLoadOptions(), catalog);
  await refreshTree();
  vscode.window.showInformationMessage(t("notification.sessionManagerRemoved", sessions.length));
  managerPanel?.webview.postMessage({ type: "removeDone" });
}

async function postManagerInit(
  webview: vscode.Webview,
  tree: SessionTreeProvider,
  buildLoadOptions: () => HistoryLoadOptions
): Promise<void> {
  try {
    const catalog = loadCatalogSettings();
    await syncCatalog(buildLoadOptions(), catalog);
    const outputLanguage = getLlmOutputLanguage();
    const [stats, gtdCounts, firstPage] = await Promise.all([
      queryManagerStats(catalog.dbPath),
      queryGtdCountsFromCatalog(catalog.dbPath),
      queryFilteredSessionsPage(catalog.dbPath, {
        limit: MANAGER_PAGE_SIZE,
        offset: 0,
        outputLanguage,
        summaryPolicy: "any"
      })
    ]);
    const taggedCount = GTD_STATUSES.reduce((sum, status) => sum + (gtdCounts[status] ?? 0), 0);
    const sessions = serializeManagerSessions(firstPage.sessions, tree);
    webview.postMessage({
      type: "init",
      uiStrings: getSessionManagerUiStrings(),
      sessions,
      stats,
      untaggedCount: Math.max(0, stats.total - taggedCount),
      filteredTotal: firstPage.total,
      hasMore: sessions.length < firstPage.total,
      gtdStatuses: GTD_STATUSES.map((status) => ({
        status,
        label: gtdStatusLabel(status),
        count: gtdCounts[status] ?? 0
      }))
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(t("notification.sessionManagerLoadFailed", message));
  }
}

async function handleManagerQueryPage(
  webview: vscode.Webview,
  tree: SessionTreeProvider,
  message: {
    offset?: number;
    limit?: number;
    search?: string;
    providers?: string[];
    ageDays?: string;
    gtdFilter?: string | null;
  }
): Promise<void> {
  const catalog = loadCatalogSettings();
  const offset = Math.max(0, Math.floor(message.offset ?? 0));
  const limit = Math.max(1, Math.min(Math.floor(message.limit ?? MANAGER_PAGE_SIZE), 500));
  const days = message.ageDays && message.ageDays !== "all" ? Number(message.ageDays) : 0;
  const olderThanMs = days > 0 ? Date.now() - days * 24 * 60 * 60 * 1000 : undefined;
  const providers = Array.isArray(message.providers) ? message.providers : undefined;
  if (providers && providers.length === 0) {
    webview.postMessage({
      type: "pageResult",
      offset: 0,
      append: false,
      total: 0,
      hasMore: false,
      sessions: []
    });
    return;
  }
  const page = await queryFilteredSessionsPage(catalog.dbPath, {
    limit,
    offset,
    search: message.search,
    providers,
    olderThanMs,
    gtdFilter: message.gtdFilter,
    outputLanguage: getLlmOutputLanguage(),
    summaryPolicy: "any"
  });
  const sessions = serializeManagerSessions(page.sessions, tree);
  webview.postMessage({
    type: "pageResult",
    offset,
    append: offset > 0,
    total: page.total,
    hasMore: offset + sessions.length < page.total,
    sessions
  });
}

function serializeManagerSessions(
  sessions: AgentSession[],
  tree: SessionTreeProvider
): ManagerSessionPayload[] {
  const enrichedSessions = enrichSessionsWithTreeSummaries(sessions, tree.getSessions());
  return enrichedSessions.map((enrichedSession) => {
    const subtitle = buildSessionSubtitle(enrichedSession);
    const search = enrichSearchSessionItem(enrichedSession, tree);
    return {
      provider: enrichedSession.provider,
      id: enrichedSession.id,
      title: search.title,
      projectPath: enrichedSession.projectPath,
      projectName: search.projectName,
      updatedAtMs: enrichedSession.updatedAt,
      updatedAtLabel: relativeTime(enrichedSession.updatedAt),
      subtitle,
      ...(search.gtdStatus && search.gtdStatusLabel
        ? { gtdStatus: search.gtdStatus, gtdStatusLabel: search.gtdStatusLabel }
        : {})
    };
  });
}

function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const htmlPath = vscode.Uri.joinPath(extensionUri, "media", "sessionManager.html").fsPath;
  const styleUri = webview
    .asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "sessionManager.css"))
    .with({ query: WEBVIEW_ASSET_VERSION });
  const scriptUri = webview
    .asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "sessionManager.js"))
    .with({ query: WEBVIEW_ASSET_VERSION });
  const nonce = getNonce();

  let html = fs.readFileSync(htmlPath, "utf8");
  html = html
    .replaceAll("{{cspSource}}", webview.cspSource)
    .replaceAll("{{nonce}}", nonce)
    .replaceAll("{{styleUri}}", styleUri.toString())
    .replaceAll("{{scriptUri}}", scriptUri.toString());

  return html;
}

export async function refreshSessionManagerPanel(): Promise<void> {
  if (!managerPanel || !activeManagerTree || !activeManagerBuildLoadOptions) {
    return;
  }

  managerPanel.title = t("panel.sessionManagerTitle");
  await postManagerInit(managerPanel.webview, activeManagerTree, activeManagerBuildLoadOptions);
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}