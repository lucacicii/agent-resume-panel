import * as vscode from "vscode";
import { AgentProvider, AgentSession } from "../history";
import { t } from "../i18n";
import { openClaudeCodePanelResumeFlow, shouldResumeClaudeInPanel } from "./claudeCodePanel";
import {
  getCodexResumeMode,
  openCodexIdePanelResumeFlow,
  shouldResumeCodexInIdePanel
} from "./codexIdePanel";
import { buildNewSessionCommand, buildResumeCommand } from "./commandBuilder";
import { openAlmaThread, openNewAlmaSession } from "./almaApp";
import { openCodexAppSession } from "./codexApp";
import {
  launchCommandInHerdr,
  openHerdrResume,
  shouldAutoResumeInHerdr,
  shouldStartNewSessionInHerdr
} from "./herdrTerminal";

export { buildNewSessionCommand, buildResumeCommand };

const resumeTerminals = new Map<string, vscode.Terminal>();
let closeTerminalListener: vscode.Disposable | undefined;

export function openSessionResume(session: AgentSession, context?: vscode.ExtensionContext): void {
  if (session.provider === "cursor-ide") {
    vscode.window.showInformationMessage("Cursor IDE chat resume is unavailable; open this project in Cursor to continue.");
    return;
  }
  if (session.provider === "alma") {
    void openAlmaThread(session);
    return;
  }
  if (shouldAutoResumeInHerdr(session)) {
    void openHerdrResume(session, context);
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

  const terminalKey = resumeTerminalKey(session);
  const existingTerminal = resumeTerminals.get(terminalKey);
  if (existingTerminal) {
    existingTerminal.show();
    return;
  }

  ensureCloseTerminalListener();

  const terminal = vscode.window.createTerminal({
    name: t("terminal.nameResume", providerLabel(session.provider), truncate(session.title, 32)),
    cwd: session.projectPath || undefined,
    location: terminalLocation(),
    isTransient: false
  });

  resumeTerminals.set(terminalKey, terminal);
  terminal.show();
  terminal.sendText(buildResumeCommand(session), true);
}

export function openCodexAppResumeTerminal(session: AgentSession, context?: vscode.ExtensionContext): void {
  void showImageSupportHint(context);
  void openCodexAppSession(session);
}

export function openNewSessionTerminal(provider: AgentProvider, projectPath: string, context?: vscode.ExtensionContext): void {
  if (provider === "alma") {
    void openNewAlmaSession(projectPath);
    return;
  }
  const command = buildNewSessionCommand(provider, projectPath);
  if (shouldStartNewSessionInHerdr(projectPath)) {
    void launchCommandInHerdr({
      cwd: projectPath,
      command,
      name: `${provider}-new`,
      labels: projectPath ? { workspace: projectPath } : undefined
    })
      .then((launched) => {
        if (!launched) {
          openFallbackNewSessionTerminal(provider, projectPath, command, context);
        }
      })
      .catch((error) => {
        console.error("[agent-resume-panel] Failed to launch new session in Herdr, falling back:", error);
        openFallbackNewSessionTerminal(provider, projectPath, command, context);
      });
    return;
  }

  openFallbackNewSessionTerminal(provider, projectPath, command, context);
}

function openFallbackNewSessionTerminal(
  provider: AgentProvider,
  projectPath: string,
  command: string,
  context?: vscode.ExtensionContext
): void {
  void showImageSupportHint(context);

  const terminal = vscode.window.createTerminal({
    name: t("terminal.nameNewSession", providerLabel(provider)),
    cwd: projectPath || undefined,
    location: terminalLocation(),
    isTransient: false
  });

  terminal.show();
  terminal.sendText(command, true);
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

function ensureCloseTerminalListener(): void {
  if (closeTerminalListener) {
    return;
  }

  closeTerminalListener = vscode.window.onDidCloseTerminal((closedTerminal) => {
    for (const [key, terminal] of resumeTerminals) {
      if (terminal === closedTerminal) {
        resumeTerminals.delete(key);
        break;
      }
    }
  });
}

function resumeTerminalKey(session: AgentSession): string {
  return `${session.provider}:${session.id}`;
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
  if (provider === "opencode") {
    return t("terminal.providerLabelOpencode");
  }
  if (provider === "pi") {
    return t("terminal.providerLabelPi");
  }
  if (provider === "prime") {
    return t("terminal.providerLabelPrime");
  }
  if (provider === "omp") {
    return t("terminal.providerLabelOmp");
  }
  if (provider === "cursor") {
    return "Cursor CLI";
  }
  if (provider === "cursor-ide") {
    return "Cursor IDE";
  }
  if (provider === "alma") {
    return "Alma";
  }
  return t("terminal.providerLabelClaude");
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}...`;
}
