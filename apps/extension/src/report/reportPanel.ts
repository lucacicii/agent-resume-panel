import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  calendarCells,
  dayKeyFromDate,
  dayKeyFromMs,
  desktopDbPath,
  digestIndex,
  isFuturePeriod,
  listSessionsInRange,
  paddedMonthRange,
  rangeForPeriod,
  readReportEntriesInRange,
  viewMonthKey,
  type ReportEntry,
  type ReportPeriodType
} from "@agent-resume/core/extension";
import { AcpChatManager } from "../acp/acpChatManager";
import { loadCatalogSettings } from "../catalog";
import { querySessionById } from "../catalog/query";
import { AgentSession } from "../history/types";
import { t } from "../i18n";
import { panelHomeFromConfig } from "../acp/newSession";
import { openSessionPreviewPanel } from "../preview/sessionPreviewPanel";
import { SessionTreeProvider } from "../tree/sessionTree";
import { getReportViewerUiStrings } from "../webview/uiStrings";
import { relativeTime } from "../util/relativeTime";

const WEBVIEW_ASSET_VERSION = "2";

type Focus = { type: ReportPeriodType; key: string };

interface ReportSessionPayload {
  provider: AgentSession["provider"];
  id: string;
  title: string;
  projectPath: string;
  projectName: string;
  updatedAtMs: number;
  updatedAtLabel: string;
}

interface MonthPayload {
  year: number;
  month: number;
  monthKey: string;
  cells: ReturnType<typeof calendarCells>;
  digestKeys: string[];
  sessionDays: string[];
  hasMonthDigest: boolean;
  dbAvailable: boolean;
}

let reportPanel: vscode.WebviewPanel | undefined;
let activeTree: SessionTreeProvider | undefined;
let activeRefreshTree: (() => Promise<void>) | undefined;
let activeContext: vscode.ExtensionContext | undefined;
let activeAcpChatManager: AcpChatManager | undefined;
let viewState = {
  year: new Date().getFullYear(),
  month: new Date().getMonth()
};
let focusState: Focus = { type: "day", key: dayKeyFromDate(new Date()) };

export async function openReportPanel(
  context: vscode.ExtensionContext,
  tree: SessionTreeProvider,
  refreshTree: () => Promise<void>,
  acpChatManager: AcpChatManager
): Promise<void> {
  const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
  activeTree = tree;
  activeRefreshTree = refreshTree;
  activeContext = context;
  activeAcpChatManager = acpChatManager;

  if (reportPanel) {
    reportPanel.title = t("panel.reportTitle");
    reportPanel.reveal(column);
    await postInit(reportPanel.webview);
    return;
  }

  reportPanel = vscode.window.createWebviewPanel(
    "agentResume.reportViewer",
    t("panel.reportTitle"),
    column,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, "media"),
        vscode.Uri.joinPath(context.extensionUri, "node_modules", "marked"),
        vscode.Uri.joinPath(context.extensionUri, "node_modules", "dompurify")
      ]
    }
  );

  reportPanel.iconPath = vscode.Uri.joinPath(context.extensionUri, "resources", "agent-resume.svg");
  reportPanel.webview.html = getWebviewHtml(reportPanel.webview, context.extensionUri);

  reportPanel.webview.onDidReceiveMessage(async (message: {
    type?: string;
    year?: number;
    month?: number;
    focusType?: ReportPeriodType;
    focusKey?: string;
    provider?: AgentSession["provider"];
    id?: string;
  }) => {
    if (!reportPanel) {
      return;
    }

    if (message.type === "ready" || message.type === "refresh") {
      await postInit(reportPanel.webview);
      return;
    }

    if (message.type === "setView" && Number.isFinite(message.year) && Number.isFinite(message.month)) {
      viewState = { year: Number(message.year), month: Number(message.month) };
      const monthKey = viewMonthKey(viewState.year, viewState.month);
      if (focusState.type === "month") {
        focusState = { type: "month", key: monthKey };
      }
      await postMonthAndFocus(reportPanel.webview);
      return;
    }

    if (
      message.type === "selectFocus" &&
      (message.focusType === "day" || message.focusType === "week" || message.focusType === "month") &&
      typeof message.focusKey === "string" &&
      message.focusKey.trim()
    ) {
      focusState = { type: message.focusType, key: message.focusKey.trim() };
      if (message.focusType === "day" || message.focusType === "month") {
        const [year, month] = message.focusKey.split("-").map(Number);
        if (Number.isFinite(year) && Number.isFinite(month)) {
          viewState = {
            year,
            month: message.focusType === "month" ? month - 1 : month - 1
          };
        }
      } else {
        const range = rangeForPeriod("week", message.focusKey);
        if (range) {
          const date = new Date(range.fromMs);
          viewState = { year: date.getFullYear(), month: date.getMonth() };
        }
      }
      await postMonthAndFocus(reportPanel.webview);
      return;
    }

    if (message.type === "openSession" && message.provider && message.id) {
      await openSessionFromReport(message.provider, message.id);
      return;
    }

    if (message.type === "goToday") {
      const now = new Date();
      viewState = { year: now.getFullYear(), month: now.getMonth() };
      focusState = { type: "day", key: dayKeyFromDate(now) };
      await postMonthAndFocus(reportPanel.webview);
    }
  });

  reportPanel.onDidDispose(() => {
    reportPanel = undefined;
    activeTree = undefined;
    activeRefreshTree = undefined;
    activeContext = undefined;
    activeAcpChatManager = undefined;
  });

  await postInit(reportPanel.webview);
}

export async function refreshReportPanel(): Promise<void> {
  if (!reportPanel) {
    return;
  }
  reportPanel.title = t("panel.reportTitle");
  await postInit(reportPanel.webview);
}

async function postInit(webview: vscode.Webview): Promise<void> {
  webview.postMessage({
    type: "init",
    uiStrings: getReportViewerUiStrings(),
    locale: vscode.env.language || "en"
  });
  await postMonthAndFocus(webview);
}

async function postMonthAndFocus(webview: vscode.Webview): Promise<void> {
  try {
    const month = await loadMonthPayload(viewState.year, viewState.month);
    const focus = await loadFocusPayload(focusState);
    webview.postMessage({
      type: "data",
      view: viewState,
      focus: focusState,
      month,
      focusData: focus
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    webview.postMessage({
      type: "error",
      message
    });
    vscode.window.showErrorMessage(t("notification.reportLoadFailed", message));
  }
}

async function loadMonthPayload(year: number, month: number): Promise<MonthPayload> {
  const panelHome = panelHomeFromConfig();
  const desktopDb = desktopDbPath(panelHome);
  const catalog = loadCatalogSettings();
  const padded = paddedMonthRange(year, month);
  const exact = rangeForPeriod("month", viewMonthKey(year, month));
  const dbAvailable = fs.existsSync(desktopDb);

  const [entries, monthSessions] = await Promise.all([
    readReportEntriesInRange(desktopDb, {
      startMs: padded.fromMs,
      endMs: padded.toMs,
      limit: 300
    }),
    exact
      ? listSessionsInRange(catalog.dbPath, exact.fromMs, exact.toMs, 2000)
      : Promise.resolve([] as Awaited<ReturnType<typeof listSessionsInRange>>)
  ]);

  const index = digestIndex(entries);
  const monthKey = viewMonthKey(year, month);
  return {
    year,
    month,
    monthKey,
    cells: calendarCells(year, month),
    digestKeys: Array.from(index.keys()),
    sessionDays: Array.from(
      new Set(monthSessions.map((session) => dayKeyFromMs(session.updatedAt)))
    ),
    hasMonthDigest: index.has(`monthly:${monthKey}`),
    dbAvailable
  };
}

async function loadFocusPayload(focus: Focus): Promise<{
  sessions: ReportSessionPayload[];
  entry: ReportEntry | null;
  isFuture: boolean;
  level: "daily" | "weekly" | "monthly";
}> {
  const panelHome = panelHomeFromConfig();
  const desktopDb = desktopDbPath(panelHome);
  const catalog = loadCatalogSettings();
  const range = rangeForPeriod(focus.type, focus.key);
  const level = focus.type === "day" ? "daily" : focus.type === "week" ? "weekly" : "monthly";

  if (!range) {
    return { sessions: [], entry: null, isFuture: false, level };
  }

  const [sessions, entries] = await Promise.all([
    listSessionsInRange(catalog.dbPath, range.fromMs, range.toMs, 500),
    readReportEntriesInRange(desktopDb, {
      startMs: range.fromMs,
      endMs: range.toMs,
      level,
      limit: 20
    })
  ]);

  const index = digestIndex(entries);
  const entry = index.get(`${level}:${focus.key}`) ?? null;

  return {
    sessions: sessions.map((session) => ({
      provider: session.provider as AgentSession["provider"],
      id: session.id,
      title: session.title || session.id,
      projectPath: session.projectPath || "",
      projectName: path.basename(session.projectPath || "") || session.projectPath || "",
      updatedAtMs: session.updatedAt,
      updatedAtLabel: relativeTime(session.updatedAt)
    })),
    entry,
    isFuture: isFuturePeriod(focus.type, focus.key),
    level
  };
}

async function openSessionFromReport(
  provider: AgentSession["provider"],
  id: string
): Promise<void> {
  if (!activeTree || !activeRefreshTree || !activeContext || !activeAcpChatManager) {
    return;
  }
  if (provider === "chat") {
    return;
  }

  const catalog = loadCatalogSettings();
  let session = await querySessionById(catalog.dbPath, provider, id);
  if (!session) {
    session = activeTree.getSessions().find((item) => item.provider === provider && item.id === id);
  }
  if (!session) {
    vscode.window.showWarningMessage(t("notification.reportSessionNotFound"));
    return;
  }

  await openSessionPreviewPanel(
    session,
    activeTree,
    activeRefreshTree,
    activeContext,
    activeAcpChatManager
  );
}

function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const htmlPath = vscode.Uri.joinPath(extensionUri, "media", "reportViewer.html").fsPath;
  const styleUri = webview
    .asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "reportViewer.css"))
    .with({ query: WEBVIEW_ASSET_VERSION });
  const scriptUri = webview
    .asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "reportViewer.js"))
    .with({ query: WEBVIEW_ASSET_VERSION });
  const markedUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "node_modules", "marked", "lib", "marked.umd.js")
  );
  const purifyUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "node_modules", "dompurify", "dist", "purify.min.js")
  );
  const nonce = getNonce();

  let html = fs.readFileSync(htmlPath, "utf8");
  html = html
    .replaceAll("{{cspSource}}", webview.cspSource)
    .replaceAll("{{nonce}}", nonce)
    .replaceAll("{{styleUri}}", styleUri.toString())
    .replaceAll("{{scriptUri}}", scriptUri.toString())
    .replaceAll("{{markedUri}}", markedUri.toString())
    .replaceAll("{{purifyUri}}", purifyUri.toString());

  return html;
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
