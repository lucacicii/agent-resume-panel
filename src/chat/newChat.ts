import * as vscode from "vscode";
import { expandHome } from "../history/pathUtils";
import { TerminalAgentProvider } from "./types";
import { createChatRecord } from "./store";

export const TERMINAL_AGENT_OPTIONS: Array<{
  label: string;
  description: string;
  provider: TerminalAgentProvider;
}> = [
  { label: "$(hubot) Codex", description: "Bind chat to Codex", provider: "codex" },
  { label: "$(comment-discussion) Claude", description: "Bind chat to Claude", provider: "claude" },
  { label: "$(sparkle) Antigravity CLI", description: "Bind chat to agy", provider: "agy" },
  { label: "$(rocket) Grok Build", description: "Bind chat to Grok", provider: "grok" },
  { label: "$(terminal) OpenCode", description: "Bind chat to OpenCode", provider: "opencode" },
  { label: "$(symbol-method) Pi", description: "Bind chat to Pi", provider: "pi" }
];

export async function pickTerminalAgentProvider(): Promise<TerminalAgentProvider | undefined> {
  const picked = await vscode.window.showQuickPick(TERMINAL_AGENT_OPTIONS, {
    title: "Choose Linked Agent",
    placeHolder: "This chat will hand off to one agent session"
  });
  return picked?.provider;
}

export function panelHomeFromConfig(): string {
  return expandHome(vscode.workspace.getConfiguration("agentResume").get<string>("panelHome", "~/.agent-resume-panel"));
}

export async function createChatSession(projectPath: string, provider: TerminalAgentProvider) {
  return createChatRecord(panelHomeFromConfig(), projectPath, provider);
}