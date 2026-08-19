import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { AcpChatManager } from "../acp/acpChatManager";
import { AgentSession } from "../history";
import { loadSessionPreview } from "../history/preview";
import { renameSessionWithCatalog } from "../catalog/rename";
import { loadRenameHomes } from "../history/rename/homes";
import { getLlmConfig, isLlmConfigured } from "../llm/config";

import { getCachedSummary } from "../llm/summaryCache";
import { pickResumeTarget, resumeSession } from "./resumeActions";
import { canHandoffSession, runContinueWithAgent } from "./handoffActions";
import { runAutoRename, runSummarize } from "./sessionAssistActions";
import { openSettingsPanelToLlm } from "../settings/settingsPanel";
import { LLM_API_KEY_SECRET } from "../settings/settingsSchema";
import { t } from "../i18n";
import { getSessionPreviewUiStrings } from "../webview/uiStrings";
import { SessionTreeProvider } from "../tree/sessionTree";

let previewPanel: vscode.WebviewPanel | undefined;
let llmConfigRefreshRegistered = false;
let activeSessionKey: string | undefined;
let activeTree: SessionTreeProvider | undefined;
let activeRefreshTree: (() => Promise<void>) | undefined;
let activeContext: vscode.ExtensionContext | undefined;
let activeAcpChatManager: AcpChatManager | undefined;

export async function openSessionPreviewPanel(
  session: AgentSession,
  tree: SessionTreeProvider,
  refreshTree: () => Promise<void>,
  context: vscode.ExtensionContext,
  acpChatManager: AcpChatManager
): Promise<void> {
  const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.Beside;
  const sessionKey = `${session.provider}:${session.id}`;

  if (previewPanel && activeSessionKey === sessionKey) {
    activeTree = tree;
    activeRefreshTree = refreshTree;
    activeContext = context;
    activeAcpChatManager = acpChatManager;
    previewPanel.title = t("panel.sessionPreviewTitle", session.title);
    previewPanel.reveal(column);
    await sendPreviewData(previewPanel.webview, session);
    return;
  }

  if (previewPanel) {
    previewPanel.dispose();
    previewPanel = undefined;
    activeSessionKey = undefined;
  }

  previewPanel = vscode.window.createWebviewPanel(
    "agentResume.sessionPreview",
    t("panel.sessionPreviewTitle", session.title),
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
  activeContext = context;
  activeAcpChatManager = acpChatManager;
  registerLlmConfigRefresh(context);
  previewPanel.iconPath = vscode.Uri.joinPath(getExtensionUri(), "resources", "agent-resume.svg");
  previewPanel.webview.html = getWebviewHtml(previewPanel.webview);

  previewPanel.webview.onDidReceiveMessage(async (message: { type?: string }) => {
    if (message.type === "ready") {
      await sendPreviewData(previewPanel!.webview, session);
      return;
    }

    if (message.type === "resume") {
      await handleResume();
      return;
    }

    if (message.type === "resumeWith") {
      await handleResumeWith();
      return;
    }

    if (message.type === "rename") {
      await handleRename(previewPanel!);
      return;
    }

    if (message.type === "summarize") {
      const activeSession = findActiveSession();
      if (activeSession && activeContext) {
        await runSummarize(activeSession, activeContext, previewPanel!.webview, activeTree);
      }
      return;
    }

    if (message.type === "autoRename") {
      const activeSession = findActiveSession();
      if (activeSession && activeContext && activeTree && activeRefreshTree) {
        await runAutoRename(activeSession, activeTree, activeRefreshTree, activeContext, {
          webview: previewPanel!.webview,
          panel: previewPanel!
        });
      }
      return;
    }

    if (message.type === "continueWithAgent") {
      const activeSession = findActiveSession();
      if (activeSession && activeContext && activeAcpChatManager) {
        await runContinueWithAgent(activeSession, activeContext, activeAcpChatManager, previewPanel!.webview);
      }
      return;
    }

    if (message.type === "openLlmSettings") {
      if (activeContext) {
        await openSettingsPanelToLlm(activeContext);
      }
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
    activeContext = undefined;
    activeAcpChatManager = undefined;
  });
}

async function handleResume(): Promise<void> {
  const session = findActiveSession();
  if (!session) {
    return;
  }

  await resumeSession(session, "vscode", activeContext);
}

async function handleResumeWith(): Promise<void> {
  const session = findActiveSession();
  if (!session) {
    return;
  }

  const target = await pickResumeTarget(session);
  if (!target) {
    return;
  }

  await resumeSession(session, target, activeContext);
}

async function handleRename(panel: vscode.WebviewPanel): Promise<void> {
  const webview = panel.webview;
  const session = findActiveSession();
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
    await activeRefreshTree?.();
    panel.title = t("panel.sessionPreviewTitle", newTitle.trim());
    webview.postMessage({ type: "titleUpdated", title: newTitle.trim() });
    vscode.window.showInformationMessage(t("notification.sessionRenamed"));
  } catch (error) {
    const errorMessage = formatError(error);
    webview.postMessage({ type: "renameDone" });
    vscode.window.showErrorMessage(t("notification.renameFailed", errorMessage));
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

function registerLlmConfigRefresh(context: vscode.ExtensionContext): void {
  if (llmConfigRefreshRegistered) {
    return;
  }

  llmConfigRefreshRegistered = true;
  context.subscriptions.push(
    context.secrets.onDidChange((event) => {
      if (event.key === LLM_API_KEY_SECRET) {
        void refreshActivePreview();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("agentResume.llm")) {
        void refreshActivePreview();
      }
    })
  );
}

async function refreshActivePreview(): Promise<void> {
  const session = findActiveSession();
  if (!session || !previewPanel) {
    return;
  }

  await sendPreviewData(previewPanel.webview, session);
}

async function sendPreviewData(webview: vscode.Webview, session: AgentSession): Promise<void> {
  try {
    const preview = await loadSessionPreview(session, loadRenameHomes());
    const llmConfigured = activeContext ? await isLlmConfigured(activeContext) : false;
    const llmConfig = activeContext ? await getLlmConfig(activeContext) : undefined;
    const cachedSummary =
      activeContext && llmConfig
        ? await getCachedSummary(activeContext, session, llmConfig.outputLanguage)
        : undefined;
    webview.postMessage({
      type: "init",
      uiStrings: getSessionPreviewUiStrings(),
      provider: session.provider,
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
    const errorMessage = formatError(error);
    webview.postMessage({
      type: "error",
      error: errorMessage
    });
    vscode.window.showErrorMessage(t("notification.previewFailed", errorMessage));
  }
}

export async function refreshSessionPreviewPanel(): Promise<void> {
  if (!previewPanel) {
    return;
  }

  const session = findActiveSession();
  if (session) {
    previewPanel.title = t("panel.sessionPreviewTitle", session.title);
  }

  await refreshActivePreview();
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