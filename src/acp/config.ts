import * as vscode from "vscode";
import { expandHome } from "../history/pathUtils";
import { ACP_AGENT_OPTIONS, DEFAULT_ACP_AGENT_LAUNCH } from "./agentRegistry";
import { AcpAgentLaunchConfig, AcpAgentProvider } from "./types";

export function panelHomeFromConfig(): string {
  return expandHome(vscode.workspace.getConfiguration("agentResume").get<string>("panelHome", "~/.agent-resume-panel"));
}

export function loadAcpAgentLaunch(provider: AcpAgentProvider): AcpAgentLaunchConfig {
  const config = vscode.workspace.getConfiguration("agentResume");
  const command = config.get<string>(`acp.agents.${provider}.command`, DEFAULT_ACP_AGENT_LAUNCH[provider].command);
  const args = config.get<string[]>(`acp.agents.${provider}.args`, DEFAULT_ACP_AGENT_LAUNCH[provider].args);
  const envEntries = config.get<Record<string, string>>(`acp.agents.${provider}.env`, {});
  const env = { ...DEFAULT_ACP_AGENT_LAUNCH[provider].env, ...envEntries };
  return {
    command,
    args: [...args],
    env: Object.keys(env).length ? env : undefined
  };
}

export function autoApprovePermissions(): boolean {
  return vscode.workspace.getConfiguration("agentResume").get<string>("acp.autoApprovePermissions", "ask") === "allowAll";
}

export async function pickAcpAgentProvider(): Promise<AcpAgentProvider | undefined> {
  const picked = await vscode.window.showQuickPick(ACP_AGENT_OPTIONS, {
    title: "Choose ACP Agent",
    placeHolder: "Select the coding agent for this chat session"
  });
  return picked?.provider;
}