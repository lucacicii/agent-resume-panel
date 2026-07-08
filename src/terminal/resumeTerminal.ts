import * as vscode from "vscode";
import { AgentProvider, AgentSession } from "../history";
import { t } from "../i18n";
import { openAlmaThread } from "./almaApp";
import { openClaudeCodePanelResumeFlow, shouldResumeClaudeInPanel } from "./claudeCodePanel";
import {
  getCodexResumeMode,
  openCodexIdePanelResumeFlow,
  shouldResumeCodexInIdePanel
} from "./codexIdePanel";
import { buildNewSessionCommand, buildResumeCommand } from "./commandBuilder";

export { buildNewSessionCommand, buildResumeCommand };

export function openSessionResume(session: AgentSession, context?: vscode.ExtensionContext): void {
  if (session.provider === "alma") {
    void openAlmaThread(session);
    return;
  }

  if (session.provider === "claude" && shouldResumeClaudeInPanel()) {
    void openClaudeCodePanelResumeFlow(session, context);
    return;
  }

  if (session.provider === "codex" && shouldResumeCodexInIdePanel()) {
    void openCodexIdePanelResumeFlow(session, context);
    return;
  }

  if (session.provider === "codex" && getCodexResumeMode() === "app") {
    openCodexAppResumeTerminal(session, context);
    return;
  }

  openResumeTerminal(session, context);
}

export function openResumeTerminal(session: AgentSession, context?: vscode.ExtensionContext): void {
  void showImageSupportHint(context);

  const terminal = vscode.window.createTerminal({
    name: t("terminal.nameResume", providerLabel(session.provider), truncate(session.title, 32)),
    cwd: session.projectPath || undefined,
    location: terminalLocation(),
    isTransient: false
  });

  terminal.show();
  terminal.sendText(buildResumeCommand(session), true);
}

export function openCodexAppResumeTerminal(session: AgentSession, context?: vscode.ExtensionContext): void {
  if (session.provider !== "codex") {
    return;
  }

  void showImageSupportHint(context);

  const terminal = vscode.window.createTerminal({
    name: t("terminal.nameCodexApp", truncate(session.title, 28)),
    cwd: session.projectPath || undefined,
    location: terminalLocation(),
    isTransient: false
  });

  terminal.show();
  terminal.sendText(buildResumeCommand(session), true);
  setTimeout(() => {
    terminal.sendText("/app", false);
    setTimeout(() => {
      sendTerminalEnter(terminal);
    }, 300);
  }, 1200);
}

export function openNewSessionTerminal(provider: AgentProvider, projectPath: string, context?: vscode.ExtensionContext): void {
  void showImageSupportHint(context);

  const terminal = vscode.window.createTerminal({
    name: t("terminal.nameNewSession", providerLabel(provider)),
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
  vscode.window.showInformationMessage(t("notification.vscodeTerminalImagesHint"));
}

function providerLabel(provider: AgentSession["provider"]): string {
  if (provider === "codex") {
    return t("terminal.providerLabelCodex");
  }
  if (provider === "agy") {
    return t("terminal.providerLabelAgy");
  }
  if (provider === "grok") {
    return t("terminal.providerLabelGrok");
  }
  if (provider === "alma") {
    return t("terminal.providerLabelAlma");
  }
  if (provider === "opencode") {
    return t("terminal.providerLabelOpencode");
  }
  if (provider === "pi") {
    return t("terminal.providerLabelPi");
  }
  return t("terminal.providerLabelClaude");
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}...`;
}

function sendTerminalEnter(terminal: vscode.Terminal): void {
  terminal.show(false);
  void vscode.commands
    .executeCommand("workbench.action.terminal.sendSequence", { text: "\u000D" })
    .then(undefined, () => {
      terminal.sendText("\n", false);
    });
}
