import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { AgentSession } from "../history";
import { loadSessionPreview } from "../history/preview";
import { renameSession } from "../history/rename";
import { loadRenameHomes } from "../history/rename/homes";
import { SessionTreeProvider } from "../tree/sessionTree";

let previewPanel: vscode.WebviewPanel | undefined;
let activeSessionKey: string | undefined;
let activeTree: SessionTreeProvider | undefined;
let activeRefreshTree: (() => Promise<void>) | undefined;

export async function openSessionPreviewPanel(
  session: AgentSession,
  tree: SessionTreeProvider,
  refreshTree: () => Promise<void>
): Promise<void> {
  const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.Beside;
  const sessionKey = `${session.provider}:${session.id}`;

  if (previewPanel && activeSessionKey === sessionKey) {
    activeTree = tree;
    activeRefreshTree = refreshTree;
    previewPanel.reveal(column);
    return;
  }

  if (previewPanel) {
    previewPanel.dispose();
    previewPanel = undefined;
    activeSessionKey = undefined;
  }

  previewPanel = vscode.window.createWebviewPanel(
    "agentResume.sessionPreview",
    `Preview: ${session.title}`,
    column,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(getExtensionUri(), "media")]
    }
  );

  activeSessionKey = sessionKey;
  activeTree = tree;
  activeRefreshTree = refreshTree;
  previewPanel.iconPath = vscode.Uri.joinPath(getExtensionUri(), "resources", "agent-resume.svg");
  previewPanel.webview.html = getWebviewHtml(previewPanel.webview);

  previewPanel.webview.onDidReceiveMessage(async (message: { type?: string }) => {
    if (message.type === "ready") {
      await sendPreviewData(previewPanel!.webview, session);
      return;
    }

    if (message.type === "rename") {
      await handleRename(previewPanel!);
      return;
    }

    if (message.type === "close") {
      previewPanel?.dispose();
    }
  });

  previewPanel.onDidDispose(() => {
    previewPanel = undefined;
    activeSessionKey = undefined;
    activeTree = undefined;
    activeRefreshTree = undefined;
  });
}

async function handleRename(panel: vscode.WebviewPanel): Promise<void> {
  const webview = panel.webview;
  const session = findActiveSession();
  if (!session) {
    webview.postMessage({ type: "renameDone" });
    return;
  }

  const newTitle = await vscode.window.showInputBox({
    title: "Rename Session",
    prompt: "Enter a new session title",
    value: session.title,
    validateInput: (value) => (value.trim() ? undefined : "Title cannot be empty.")
  });

  if (!newTitle) {
    webview.postMessage({ type: "renameDone" });
    return;
  }

  try {
    await renameSession(session, newTitle, loadRenameHomes());
    await activeRefreshTree?.();
    panel.title = `Preview: ${newTitle.trim()}`;
    webview.postMessage({ type: "titleUpdated", title: newTitle.trim() });
    vscode.window.showInformationMessage("Session renamed.");
  } catch (error) {
    const errorMessage = formatError(error);
    webview.postMessage({ type: "renameDone" });
    vscode.window.showErrorMessage(`Rename failed: ${errorMessage}`);
  }
}

function findActiveSession(): AgentSession | undefined {
  if (!activeSessionKey || !activeTree) {
    return undefined;
  }

  const separatorIndex = activeSessionKey.indexOf(":");
  if (separatorIndex < 0) {
    return undefined;
  }

  const provider = activeSessionKey.slice(0, separatorIndex);
  const id = activeSessionKey.slice(separatorIndex + 1);
  return activeTree.getSessions().find((entry) => entry.provider === provider && entry.id === id);
}

async function sendPreviewData(webview: vscode.Webview, session: AgentSession): Promise<void> {
  try {
    const preview = await loadSessionPreview(session, loadRenameHomes());
    webview.postMessage({
      type: "init",
      title: preview.title,
      messages: preview.messages,
      truncated: preview.truncated,
      warning: preview.warning
    });
  } catch (error) {
    const errorMessage = formatError(error);
    webview.postMessage({
      type: "error",
      error: errorMessage
    });
    vscode.window.showErrorMessage(`Preview failed: ${errorMessage}`);
  }
}

function getWebviewHtml(webview: vscode.Webview): string {
  const extensionUri = getExtensionUri();
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "sessionPreview.css"));
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "sessionPreview.js"));
  const nonce = getNonce();

  let html = readMediaFile(path.join(extensionUri.fsPath, "media", "sessionPreview.html"));
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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}