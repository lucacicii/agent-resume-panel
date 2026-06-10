import * as vscode from "vscode";
import { AgentProvider, AgentSession } from "../history";
import { buildNewSessionCommand, buildResumeCommand } from "./commandBuilder";

export { buildNewSessionCommand, buildResumeCommand };

export function openResumeTerminal(session: AgentSession, context?: vscode.ExtensionContext): void {
  void showImageSupportHint(context);

  const terminal = vscode.window.createTerminal({
    name: `${providerLabel(session.provider)}: ${truncate(session.title, 32)}`,
    cwd: session.projectPath || undefined,
    location: terminalLocation(),
    isTransient: false
  });

  terminal.show();
  terminal.sendText(buildResumeCommand(session), true);
}

export function openNewSessionTerminal(provider: AgentProvider, projectPath: string, context?: vscode.ExtensionContext): void {
  void showImageSupportHint(context);

  const terminal = vscode.window.createTerminal({
    name: `${providerLabel(provider)}: New Session`,
    cwd: projectPath || undefined,
    location: terminalLocation(),
    isTransient: false
  });

  terminal.show();
  terminal.sendText(buildNewSessionCommand(provider, projectPath), true);
}

function terminalLocation(): vscode.TerminalOptions["location"] {
  const config = vscode.workspace.getConfiguration("agentResume");
  const configured = config.get<string>("terminalLocation", "editorBeside");
  if (configured === "panel") {
    return vscode.TerminalLocation.Panel;
  }

  return {
    viewColumn: vscode.ViewColumn.Beside
  };
}

async function showImageSupportHint(context?: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration("agentResume");
  if (!config.get<boolean>("enableVsCodeTerminalImagesHint", true)) {
    return;
  }
  if (context?.globalState.get<boolean>("agentResume.vscodeImagesHintShown")) {
    return;
  }

  await context?.globalState.update("agentResume.vscodeImagesHintShown", true);
  vscode.window.showInformationMessage(
    "VS Code terminal can show Sixel/iTerm inline images when terminal.integrated.enableImages is enabled. Use Open in Ghostty for full Ghostty image workflows."
  );
}

function providerLabel(provider: AgentSession["provider"]): string {
  return provider === "codex" ? "Codex" : "Claude";
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}...`;
}
