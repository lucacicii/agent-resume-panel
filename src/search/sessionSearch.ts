import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { AgentProvider } from "../history";
import { basenameOrPath, compactPath } from "../history";
import { loadRenameHomes } from "../history/rename/homes";
import { renameSession } from "../history/rename";
import { loadSessionPreview } from "../history/preview";
import { openSessionResume } from "../terminal/resumeTerminal";
import {
  buildProjectList,
  serializeSessionForSearch,
  SessionTreeProvider
} from "../tree/sessionTree";

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
}

let searchPanel: vscode.WebviewPanel | undefined;

export async function searchAndOpenSessions(
  tree: SessionTreeProvider,
  refreshTree: () => Promise<void>
): Promise<void> {
  const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

  if (searchPanel) {
    searchPanel.reveal(column);
    postInitMessage(searchPanel.webview, tree);
    return;
  }

  searchPanel = vscode.window.createWebviewPanel(
    "agentResume.searchSessions",
    "Search Sessions",
    column,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(getExtensionUri(), "media")]
    }
  );

  searchPanel.iconPath = vscode.Uri.joinPath(getExtensionUri(), "resources", "agent-resume.svg");
  searchPanel.webview.html = getWebviewHtml(searchPanel.webview);

  searchPanel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
    if (message.type === "ready") {
      postInitMessage(searchPanel!.webview, tree);
      return;
    }

    if (message.type === "resume" && message.provider && message.id) {
      const session = findSession(tree, message.provider, message.id);
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

    if (message.type === "preview" && message.provider && message.id) {
      await handlePreviewMessage(tree, searchPanel!.webview, message.provider, message.id);
    }
  });

  searchPanel.onDidDispose(() => {
    searchPanel = undefined;
  });
}

async function handlePreviewMessage(
  tree: SessionTreeProvider,
  webview: vscode.Webview,
  provider: AgentProvider,
  id: string
): Promise<void> {
  const session = findSession(tree, provider, id);
  if (!session) {
    return;
  }

  webview.postMessage({ type: "previewLoading", provider, id });

  try {
    const preview = await loadSessionPreview(session, loadRenameHomes());
    webview.postMessage({
      type: "previewResult",
      provider,
      id,
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
    vscode.window.showErrorMessage(`Preview failed: ${formatError(error)}`);
  }
}

async function handleRenameMessage(
  tree: SessionTreeProvider,
  webview: vscode.Webview,
  refreshTree: () => Promise<void>,
  provider: AgentProvider,
  id: string
): Promise<void> {
  const session = findSession(tree, provider, id);
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
    await refreshTree();
    postInitMessage(webview, tree);
    vscode.window.showInformationMessage("Session renamed.");
  } catch (error) {
    webview.postMessage({ type: "renameDone" });
    vscode.window.showErrorMessage(`Rename failed: ${formatError(error)}`);
  }
}

function findSession(tree: SessionTreeProvider, provider: AgentProvider, id: string) {
  return tree.getSessions().find((entry) => entry.provider === provider && entry.id === id);
}

function postInitMessage(webview: vscode.Webview, tree: SessionTreeProvider): void {
  const sessions = tree.getSessions();
  const favoriteProjects = tree.getFavoriteProjects();
  const projects = buildProjectList(sessions, favoriteProjects);

  const payload = {
    type: "init",
    projects: projects.map(
      (project): SearchProjectPayload => ({
        projectPath: path.resolve(project.projectPath),
        name: basenameOrPath(project.projectPath),
        sessionCount: project.sessions.length,
        favorited: Boolean(project.favorited),
        compactPath: compactPath(project.projectPath)
      })
    ),
    sessions: sessions.map(serializeSessionForSearch)
  };

  webview.postMessage(payload);
}

function getWebviewHtml(webview: vscode.Webview): string {
  const extensionUri = getExtensionUri();
  const htmlUri = vscode.Uri.joinPath(extensionUri, "media", "sessionSearch.html");
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "sessionSearch.css"));
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "sessionSearch.js"));
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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}