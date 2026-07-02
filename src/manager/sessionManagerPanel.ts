import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { loadCatalogSettings, queryCatalogSessions, querySessionById, syncCatalog } from "../catalog";
import { resolveSessionById } from "../catalog/resolve";
import { AgentSession, HistoryLoadOptions } from "../history/types";
import { exportCatalogWithTranscripts } from "../catalog/transcript/export";
import { removeSessionsFromPanel } from "../catalog/mutations";
import { openSessionResume } from "../terminal/resumeTerminal";
import { relativeTime, serializeSessionForSearch, SessionTreeProvider } from "../tree/sessionTree";

interface ManagerSessionPayload {
  provider: string;
  id: string;
  title: string;
  projectPath: string;
  projectName: string;
  updatedAtMs: number;
  updatedAtLabel: string;
  removeAction: string;
}

interface ManagerStats {
  total: number;
  byProvider: Record<string, number>;
}

let managerPanel: vscode.WebviewPanel | undefined;

export async function openSessionManagerPanel(
  context: vscode.ExtensionContext,
  tree: SessionTreeProvider,
  buildLoadOptions: () => HistoryLoadOptions,
  refreshTree: () => Promise<void>
): Promise<void> {
  const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
  if (managerPanel) {
    managerPanel.reveal(column);
    await postManagerInit(managerPanel.webview, buildLoadOptions);
    return;
  }

  managerPanel = vscode.window.createWebviewPanel(
    "agentResume.sessionManager",
    "Session Manager",
    column,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")]
    }
  );

  managerPanel.iconPath = vscode.Uri.joinPath(context.extensionUri, "resources", "agent-resume.svg");
  managerPanel.webview.html = getWebviewHtml(managerPanel.webview, context.extensionUri);

  managerPanel.webview.onDidReceiveMessage(async (message) => {
    if (message.type === "ready" || message.type === "resync") {
      await refreshTree();
      await postManagerInit(managerPanel!.webview, buildLoadOptions);
      return;
    }

    if (message.type === "remove" && Array.isArray(message.items)) {
      await handleRemoveFromPanel(message.items, buildLoadOptions, refreshTree);
      await postManagerInit(managerPanel!.webview, buildLoadOptions);
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
  });
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
    openLabel: "Select export folder"
  });
  if (!folder?.[0]) {
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir = path.join(folder[0].fsPath, `agent-resume-catalog-${stamp}`);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Exporting sessions...",
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
        `Exported ${result.sessionCount} session(s), ${result.transcriptFileCount} transcript file(s) to ${result.outputDir}`
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

  const confirm = await vscode.window.showWarningMessage(
    `Remove ${sessions.length} session(s) from the panel only? Native agent storage is unchanged.`,
    { modal: true },
    "Remove"
  );
  if (confirm !== "Remove") {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Removing sessions from panel...",
      cancellable: false
    },
    async () => {
      await removeSessionsFromPanel(catalog.dbPath, sessions);
    }
  );

  await syncCatalog(buildLoadOptions(), catalog);
  await refreshTree();
  vscode.window.showInformationMessage(`Removed ${sessions.length} session(s) from panel.`);
  managerPanel?.webview.postMessage({ type: "removeDone" });
}

async function postManagerInit(webview: vscode.Webview, buildLoadOptions: () => HistoryLoadOptions): Promise<void> {
  const catalog = loadCatalogSettings();
  await syncCatalog(buildLoadOptions(), catalog);
  const sessions = await queryCatalogSessions(catalog);
  const payload = buildManagerPayload(sessions);
  webview.postMessage({
    type: "init",
    sessions: payload.sessions,
    stats: payload.stats
  });
}

function buildManagerPayload(sessions: AgentSession[]): { sessions: ManagerSessionPayload[]; stats: ManagerStats } {
  const byProvider: Record<string, number> = {};
  for (const session of sessions) {
    byProvider[session.provider] = (byProvider[session.provider] ?? 0) + 1;
  }

  return {
    stats: { total: sessions.length, byProvider },
    sessions: sessions.map((session) => {
      const search = serializeSessionForSearch(session);
      return {
        provider: session.provider,
        id: session.id,
        title: search.title,
        projectPath: session.projectPath,
        projectName: search.projectName,
        updatedAtMs: session.updatedAt,
        updatedAtLabel: relativeTime(session.updatedAt),
        removeAction: "Remove from panel only (native agent unchanged)"
      };
    })
  };
}

function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const htmlPath = vscode.Uri.joinPath(extensionUri, "media", "sessionManager.html").fsPath;
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "sessionManager.css"));
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "sessionManager.js"));
  const nonce = getNonce();

  let html = fs.readFileSync(htmlPath, "utf8");
  html = html
    .replaceAll("{{cspSource}}", webview.cspSource)
    .replaceAll("{{nonce}}", nonce)
    .replaceAll("{{styleUri}}", styleUri.toString())
    .replaceAll("{{scriptUri}}", scriptUri.toString());

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