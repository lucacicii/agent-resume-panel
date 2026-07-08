import * as vscode from "vscode";
import { t } from "../i18n";
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

const ACP_AGENT_I18N_KEYS: Record<AcpAgentProvider, { label: string; description: string }> = {
  codex: { label: "quickpick.acpAgentCodexLabel", description: "quickpick.acpAgentCodexDescription" },
  claude: { label: "quickpick.acpAgentClaudeLabel", description: "quickpick.acpAgentClaudeDescription" },
  grok: { label: "quickpick.acpAgentGrokLabel", description: "quickpick.acpAgentGrokDescription" },
  opencode: { label: "quickpick.acpAgentOpenCodeLabel", description: "quickpick.acpAgentOpenCodeDescription" },
  pi: { label: "quickpick.acpAgentPiLabel", description: "quickpick.acpAgentPiDescription" }
};

function buildAcpAgentOptions(): Array<{
  label: string;
  description: string;
  provider: AcpAgentProvider;
}> {
  return ACP_AGENT_OPTIONS.map((option) => ({
    provider: option.provider,
    label: t(ACP_AGENT_I18N_KEYS[option.provider].label),
    description: t(ACP_AGENT_I18N_KEYS[option.provider].description)
  }));
}

export async function pickAcpAgentProvider(): Promise<AcpAgentProvider | undefined> {
  const picked = await vscode.window.showQuickPick(buildAcpAgentOptions(), {
    title: t("quickpick.acpAgentTitle"),
    placeHolder: t("quickpick.acpAgentPlaceHolder")
  });
  return picked?.provider;
}