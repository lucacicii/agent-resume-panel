import * as path from "node:path";
import * as vscode from "vscode";
import { AgentSession } from "../history";
import { storePendingResume } from "./pendingResume";

/**
 * Bump this when OpenAI changes Codex IDE resume routing.
 * Setting `agentResume.codexIdePanelResume.implementationVersion` must match for panel resume to run.
 */
export const CODEX_IDE_PANEL_IMPLEMENTATION_VERSION = 1;

export const CODEX_IDE_PANEL_IMPLEMENTATION_NOTE =
  "v1: openai-codex://route/local/{id} and {editorScheme}://openai.chatgpt/local/{id}";

const CODEX_EXTENSION_IDS = ["openai.chatgpt", "OpenAI.chatgpt"];
const CODEX_OPEN_SIDEBAR_COMMAND = "chatgpt.openSidebar";
const CODEX_ROUTE_SCHEME = "openai-codex";
const CODEX_ROUTE_AUTHORITY = "route";
const CODEX_LOCAL_ROUTE_PREFIX = "/local";

const WARNING_STATE_KEY = "agentResume.codexIdePanelWarningShown";

export type CodexResumeMode = "terminal" | "panel" | "app";

export type CodexIdePanelResumeResult = "opened" | "needsFolderOpen" | "disabled" | "unsupported";

export function getCodexResumeMode(): CodexResumeMode {
  return vscode.workspace
    .getConfiguration("agentResume")
    .get<CodexResumeMode>("codexResumeMode", "terminal");
}

export function isCodexIdePanelResumeEnabled(): boolean {
  return vscode.workspace
    .getConfiguration("agentResume")
    .get<boolean>("codexIdePanelResume.enabled", true);
}

export function isCodexIdePanelImplementationCompatible(): boolean {
  const expected = vscode.workspace
    .getConfiguration("agentResume")
    .get<number>(
      "codexIdePanelResume.implementationVersion",
      CODEX_IDE_PANEL_IMPLEMENTATION_VERSION
    );

  return expected === CODEX_IDE_PANEL_IMPLEMENTATION_VERSION;
}

export function shouldResumeCodexInIdePanel(): boolean {
  return (
    getCodexResumeMode() === "panel" &&
    isCodexIdePanelResumeEnabled() &&
    isCodexIdePanelImplementationCompatible()
  );
}

export function isCodexIdePanelResumeAvailable(): boolean {
  return isCodexIdePanelResumeEnabled() && isCodexIdePanelImplementationCompatible();
}

export function getCodexExtension(): vscode.Extension<unknown> | undefined {
  for (const extensionId of CODEX_EXTENSION_IDS) {
    const extension = vscode.extensions.getExtension(extensionId);
    if (extension) {
      return extension;
    }
  }

  return vscode.extensions.all.find((extension) => extension.id.toLowerCase().endsWith(".chatgpt"));
}

export function isCodexExtensionInstalled(): boolean {
  return Boolean(getCodexExtension());
}

export async function applyCodexIdePanelContext(): Promise<void> {
  await vscode.commands.executeCommand(
    "setContext",
    "agentResume.codexIdePanelResume.enabled",
    isCodexIdePanelResumeAvailable()
  );
}

export async function openCodexIdePanelResume(
  session: AgentSession,
  context?: vscode.ExtensionContext
): Promise<CodexIdePanelResumeResult> {
  if (session.provider !== "codex") {
    return "unsupported";
  }

  if (!isCodexIdePanelResumeEnabled()) {
    vscode.window.showWarningMessage(
      "Codex IDE panel resume is disabled. Enable agentResume.codexIdePanelResume.enabled in Settings, or use terminal/Codex App resume."
    );
    return "disabled";
  }

  if (!isCodexIdePanelImplementationCompatible()) {
    const expected = vscode.workspace
      .getConfiguration("agentResume")
      .get<number>("codexIdePanelResume.implementationVersion", CODEX_IDE_PANEL_IMPLEMENTATION_VERSION);

    vscode.window.showWarningMessage(
      `Codex IDE panel resume is blocked: implementation version mismatch (extension code v${CODEX_IDE_PANEL_IMPLEMENTATION_VERSION}, settings v${expected}). Update Agent Resume Panel or align agentResume.codexIdePanelResume.implementationVersion after verifying the new Codex routes.`
    );
    return "disabled";
  }

  await showExperimentalWarning(context);

  const extension = getCodexExtension();
  if (!extension) {
    const install = "Install Extension";
    const choice = await vscode.window.showWarningMessage(
      "Codex extension (openai.chatgpt) is not installed. Install it to resume in the Codex IDE panel.",
      install
    );
    if (choice === install) {
      await vscode.commands.executeCommand("workbench.extensions.search", CODEX_EXTENSION_IDS[0]);
    }
    return "unsupported";
  }

  if (!isSessionWorkspaceOpen(session.projectPath)) {
    return "needsFolderOpen";
  }

  try {
    if (!extension.isActive) {
      await extension.activate();
    }

    const opened = await invokeCodexIdePanelOpen(session.id, extension.id);
    if (opened) {
      return "opened";
    }

    vscode.window.showErrorMessage(
      "Failed to open Codex IDE panel. Disable agentResume.codexIdePanelResume.enabled and use terminal resume, or open Codex manually and pick the thread from session history."
    );
    return "unsupported";
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to open Codex IDE panel: ${formatError(error)}`);
    return "unsupported";
  }
}

export async function openCodexIdePanelResumeFlow(
  session: AgentSession,
  context?: vscode.ExtensionContext
): Promise<void> {
  const result = await openCodexIdePanelResume(session, context);
  if (result === "opened" || result === "disabled" || result === "unsupported") {
    return;
  }

  if (!context) {
    vscode.window.showWarningMessage(
      "Open the session project in VS Code first, or use Open Folder and Resume."
    );
    return;
  }

  await storePendingResume(context, session, { codexPanel: true });
  await vscode.commands.executeCommand(
    "vscode.openFolder",
    vscode.Uri.file(normalizePath(session.projectPath)),
    true
  );
}

async function invokeCodexIdePanelOpen(sessionId: string, extensionId: string): Promise<boolean> {
  try {
    await vscode.commands.executeCommand(CODEX_OPEN_SIDEBAR_COMMAND);
  } catch {
    // Sidebar may already be visible; continue with route open attempts.
  }

  const routeUri = buildCodexRouteUri(sessionId);
  if (await tryOpenUri(routeUri)) {
    return true;
  }

  const handlerUri = buildCodexExtensionHandlerUri(sessionId, extensionId);
  if (await tryOpenUri(handlerUri)) {
    return true;
  }

  return false;
}

function buildCodexRouteUri(sessionId: string): vscode.Uri {
  return vscode.Uri.from({
    scheme: CODEX_ROUTE_SCHEME,
    authority: CODEX_ROUTE_AUTHORITY,
    path: `${CODEX_LOCAL_ROUTE_PREFIX}/${sessionId}`
  });
}

function buildCodexExtensionHandlerUri(sessionId: string, extensionId: string): vscode.Uri {
  const scheme = vscode.env.uriScheme || "vscode";
  return vscode.Uri.parse(
    `${scheme}://${extensionId}${CODEX_LOCAL_ROUTE_PREFIX}/${encodeURIComponent(sessionId)}`
  );
}

async function tryOpenUri(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.commands.executeCommand("vscode.open", uri);
    return true;
  } catch {
    return false;
  }
}

async function showExperimentalWarning(context?: vscode.ExtensionContext): Promise<void> {
  if (!context?.globalState.get<boolean>(WARNING_STATE_KEY)) {
    await context?.globalState.update(WARNING_STATE_KEY, true);
    vscode.window.showWarningMessage(
      `Codex IDE panel resume is experimental (${CODEX_IDE_PANEL_IMPLEMENTATION_NOTE}). If a Codex update breaks it, set agentResume.codexIdePanelResume.enabled to false.`
    );
  }
}

function isSessionWorkspaceOpen(projectPath: string): boolean {
  const target = normalizePath(projectPath);
  return (
    vscode.workspace.workspaceFolders?.some((folder) => normalizePath(folder.uri.fsPath) === target) ?? false
  );
}

function normalizePath(input: string): string {
  return path.resolve(input);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}