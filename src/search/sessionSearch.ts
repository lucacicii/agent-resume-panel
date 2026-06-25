import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { basenameOrPath, compactPath } from "../history";
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

let searchPanel: vscode.WebviewPanel | undefined;

export async function searchAndOpenSessions(tree: SessionTreeProvider): Promise<void> {
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

  searchPanel.webview.onDidReceiveMessage(async (message: { type?: string; provider?: string; id?: string }) => {
    if (message.type === "ready") {
      postInitMessage(searchPanel!.webview, tree);
      return;
    }

    if (message.type === "resume" && message.provider && message.id) {
      const session = tree
        .getSessions()
        .find((entry) => entry.provider === message.provider && entry.id === message.id);
      if (session) {
        searchPanel?.dispose();
        openSessionResume(session, undefined);
      }
    }
  });

  searchPanel.onDidDispose(() => {
    searchPanel = undefined;
  });
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