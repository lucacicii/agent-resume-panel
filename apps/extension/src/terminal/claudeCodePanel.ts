import * as path from "node:path";
import * as vscode from "vscode";
import { AgentSession } from "../history";
import { t } from "../i18n";
import { storePendingResume } from "./pendingResume";

const CLAUDE_CODE_EXTENSION_IDS = ["anthropic.claude-code", "Anthropic.claude-code"];
const CLAUDE_CODE_PANEL_COMMANDS = [
  "claude-vscode.primaryEditor.open",
  "claude-vscode.editor.open"
] as const;

export type ClaudeResumeMode = "terminal" | "panel";

export type ClaudePanelResumeResult = "opened" | "needsFolderOpen" | "unsupported";

export function getClaudeResumeMode(): ClaudeResumeMode {
  return vscode.workspace
    .getConfiguration("agentResume")
    .get<ClaudeResumeMode>("claudeResumeMode", "panel");
}

export function shouldResumeClaudeInPanel(): boolean {
  return getClaudeResumeMode() === "panel";
}

export function getClaudeCodeExtension(): vscode.Extension<unknown> | undefined {
  for (const extensionId of CLAUDE_CODE_EXTENSION_IDS) {
    const extension = vscode.extensions.getExtension(extensionId);
    if (extension) {
      return extension;
    }
  }

  return vscode.extensions.all.find((extension) => extension.id.toLowerCase().endsWith(".claude-code"));
}

export function isClaudeCodeExtensionInstalled(): boolean {
  return Boolean(getClaudeCodeExtension());
}

export function isSessionWorkspaceOpen(projectPath: string): boolean {
  const target = normalizePath(projectPath);
  return (
    vscode.workspace.workspaceFolders?.some((folder) => normalizePath(folder.uri.fsPath) === target) ?? false
  );
}

export async function openClaudeCodePanelResume(session: AgentSession): Promise<ClaudePanelResumeResult> {
  if (session.provider !== "claude") {
    return "unsupported";
  }

  const extension = getClaudeCodeExtension();
  if (!extension) {
    const install = t("dialog.buttonInstallExtension");
    const choice = await vscode.window.showWarningMessage(
      t("warning.claudeExtensionNotInstalled"),
      install
    );
    if (choice === install) {
      await vscode.commands.executeCommand("workbench.extensions.search", CLAUDE_CODE_EXTENSION_IDS[0]);
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

    const opened = await invokeClaudeCodePanelCommand(session.id);
    if (opened) {
      return "opened";
    }

    const openedViaUri = await openClaudeCodePanelViaUri(session.id, extension.id);
    if (openedViaUri) {
      return "opened";
    }

    vscode.window.showErrorMessage(t("error.failedOpenClaudePanelManual"));
    return "unsupported";
  } catch (error) {
    vscode.window.showErrorMessage(t("error.failedOpenClaudePanel", formatError(error)));
    return "unsupported";
  }
}

async function invokeClaudeCodePanelCommand(sessionId: string): Promise<boolean> {
  for (const command of CLAUDE_CODE_PANEL_COMMANDS) {
    try {
      if (command === "claude-vscode.editor.open") {
        await vscode.commands.executeCommand(command, sessionId, undefined, vscode.ViewColumn.Beside);
      } else {
        await vscode.commands.executeCommand(command, sessionId, undefined);
      }
      return true;
    } catch {
      continue;
    }
  }

  return false;
}

async function openClaudeCodePanelViaUri(sessionId: string, extensionId: string): Promise<boolean> {
  const scheme = vscode.env.uriScheme || "vscode";
  const uri = vscode.Uri.parse(
    `${scheme}://${extensionId}/open?session=${encodeURIComponent(sessionId)}`
  );

  try {
    await vscode.commands.executeCommand("vscode.open", uri);
    return true;
  } catch {
    try {
      await vscode.env.openExternal(uri);
      return true;
    } catch {
      return false;
    }
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function openClaudeCodePanelResumeFlow(
  session: AgentSession,
  context?: vscode.ExtensionContext
): Promise<void> {
  const result = await openClaudeCodePanelResume(session);
  if (result === "opened") {
    return;
  }

  if (result === "unsupported") {
    return;
  }

  if (!context) {
    vscode.window.showWarningMessage(t("warning.openProjectFirstOrOpenFolderResume"));
    return;
  }

  await storePendingResume(context, session, { claudePanel: true });
  await vscode.commands.executeCommand(
    "vscode.openFolder",
    vscode.Uri.file(normalizePath(session.projectPath)),
    true
  );
}

function normalizePath(input: string): string {
  return path.resolve(input);
}