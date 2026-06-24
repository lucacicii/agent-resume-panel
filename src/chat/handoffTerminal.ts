import * as vscode from "vscode";
import { AgentSession } from "../history";
import { buildNewSessionCommand, buildResumeCommand } from "../terminal/commandBuilder";
import { ChatSessionRecord } from "./types";

const terminalsByChatId = new Map<string, vscode.Terminal>();
const bootstrappedChatIds = new Set<string>();

export type ChatHandoffMode = "background" | "visible";

export function getChatHandoffMode(): ChatHandoffMode {
  const mode = vscode.workspace.getConfiguration("agentResume").get<string>("chatHandoffMode", "background");
  return mode === "visible" ? "visible" : "background";
}

export function getOrCreateHandoffTerminal(record: ChatSessionRecord): vscode.Terminal {
  const chatId = record.id;
  const cached = terminalsByChatId.get(chatId);
  if (cached && isTerminalAlive(cached)) {
    return cached;
  }

  const background = getChatHandoffMode() === "background";
  const provider = record.linkedAgent.provider;
  const title = truncate(record.title, 24);
  const terminal = vscode.window.createTerminal({
    name: `Chat→${provider}: ${title}`,
    cwd: record.projectPath || undefined,
    hideFromUser: background,
    location: terminalLocation()
  });

  terminalsByChatId.set(chatId, terminal);
  return terminal;
}

export function hasBootstrappedHandoff(chatId: string): boolean {
  return bootstrappedChatIds.has(chatId);
}

export function sendHandoffBootstrap(terminal: vscode.Terminal, record: ChatSessionRecord, prompt: string): void {
  bootstrappedChatIds.add(record.id);

  const bootstrap = record.linkedAgent.sessionId
    ? buildResumeCommand(toAgentSession(record))
    : buildNewSessionCommand(record.linkedAgent.provider, record.projectPath);

  terminal.sendText(bootstrap, true);
  scheduleHandoffPrompt(terminal, prompt, true);
}

export function sendHandoffPrompt(terminal: vscode.Terminal, prompt: string): void {
  scheduleHandoffPrompt(terminal, prompt, false);
}

export function clearHandoffTerminal(chatId: string): void {
  terminalsByChatId.delete(chatId);
  bootstrappedChatIds.delete(chatId);
}

function scheduleHandoffPrompt(terminal: vscode.Terminal, prompt: string, afterBootstrap: boolean): void {
  const configuredDelay = vscode.workspace
    .getConfiguration("agentResume")
    .get<number>("chatHandoffBootstrapDelayMs", 3000);
  const delay = afterBootstrap ? configuredDelay : 400;
  const background = getChatHandoffMode() === "background";

  setTimeout(() => {
    if (!isTerminalAlive(terminal)) {
      vscode.window.showErrorMessage("Handoff terminal closed before the agent prompt could be sent.");
      return;
    }
    if (!background) {
      terminal.show(true);
    }
    terminal.sendText(prompt, true);
  }, delay);
}

function isTerminalAlive(terminal: vscode.Terminal): boolean {
  return vscode.window.terminals.includes(terminal);
}

function terminalLocation(): vscode.TerminalOptions["location"] {
  const configured = vscode.workspace.getConfiguration("agentResume").get<string>("terminalLocation", "editorBeside");
  if (configured === "panel") {
    return vscode.TerminalLocation.Panel;
  }
  return { viewColumn: vscode.ViewColumn.Beside };
}

function toAgentSession(record: ChatSessionRecord): AgentSession {
  return {
    provider: record.linkedAgent.provider,
    id: record.linkedAgent.sessionId ?? "pending",
    title: record.title,
    projectPath: record.projectPath,
    updatedAt: record.updatedAt
  };
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}...`;
}