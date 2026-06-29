import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { llmOverridesFromDraft } from "../llm/config";
import { testLlmConnection } from "../llm/sessionAssist";
import { configureProjectMenu } from "../menu/projectContextMenu";
import { applySettingsPatch, loadSettingsSnapshot } from "./settingsIO";

let settingsPanel: vscode.WebviewPanel | undefined;
let activeContext: vscode.ExtensionContext | undefined;

interface WebviewMessage {
  type?: string;
  patch?: Record<string, unknown>;
  draft?: Record<string, unknown>;
}

export async function openSettingsPanel(context: vscode.ExtensionContext): Promise<void> {
  const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

  if (settingsPanel) {
    activeContext = context;
    settingsPanel.reveal(column);
    await sendInit(settingsPanel.webview, context);
    return;
  }

  settingsPanel = vscode.window.createWebviewPanel(
    "agentResume.settings",
    "Agent Resume Settings",
    column,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(getExtensionUri(), "media")]
    }
  );

  activeContext = context;
  settingsPanel.iconPath = vscode.Uri.joinPath(getExtensionUri(), "resources", "agent-resume.svg");
  settingsPanel.webview.html = getWebviewHtml(settingsPanel.webview);

  settingsPanel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
    const ctx = activeContext;
    if (!ctx) {
      return;
    }

    if (message.type === "ready") {
      await sendInit(settingsPanel!.webview, ctx);
      return;
    }

    if (message.type === "save" && message.patch) {
      try {
        await applySettingsPatch(ctx, message.patch);
        await sendInit(settingsPanel!.webview, ctx);
        settingsPanel!.webview.postMessage({ type: "saved" });
      } catch (error) {
        settingsPanel!.webview.postMessage({
          type: "saveError",
          error: formatError(error)
        });
      }
      return;
    }

    if (message.type === "testLlm") {
      try {
        const messageText = await testLlmConnection(ctx, llmOverridesFromDraft(message.draft));
        settingsPanel!.webview.postMessage({ type: "testResult", success: true, message: messageText });
      } catch (error) {
        settingsPanel!.webview.postMessage({
          type: "testResult",
          success: false,
          message: formatError(error)
        });
      }
      return;
    }

    if (message.type === "configureProjectMenu") {
      await configureProjectMenu();
      return;
    }
  });

  settingsPanel.onDidDispose(() => {
    settingsPanel = undefined;
    activeContext = undefined;
  });
}

async function sendInit(webview: vscode.Webview, context: vscode.ExtensionContext): Promise<void> {
  const snapshot = await loadSettingsSnapshot(context);
  webview.postMessage({
    type: "init",
    sections: snapshot.sections,
    values: snapshot.values,
    llmApiKeyConfigured: snapshot.llmApiKeyConfigured
  });
}

function getWebviewHtml(webview: vscode.Webview): string {
  const extensionUri = getExtensionUri();
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "settings.css"));
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "settings.js"));
  const nonce = getNonce();

  let html = readMediaFile(path.join(extensionUri.fsPath, "media", "settings.html"));
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