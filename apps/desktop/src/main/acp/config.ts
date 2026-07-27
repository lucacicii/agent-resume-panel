import type { PanelSettings } from "@agent-resume/core";
import { DEFAULT_ACP_AGENT_LAUNCH } from "./agentRegistry";
import type { AcpAgentLaunchConfig, AcpAgentProvider } from "./types";

export function loadAcpAgentLaunch(settings: PanelSettings, provider: AcpAgentProvider): AcpAgentLaunchConfig {
  const defaults = DEFAULT_ACP_AGENT_LAUNCH[provider];
  const override = settings.acp?.agents?.[provider];
  const command = override?.command?.trim() || defaults.command;
  const args = Array.isArray(override?.args) && override.args.length ? [...override.args] : [...defaults.args];
  const env = { ...defaults.env, ...override?.env };
  return {
    command,
    args,
    env: Object.keys(env).length ? env : undefined
  };
}

export function autoApprovePermissions(settings: PanelSettings): boolean {
  return settings.acp?.autoApprovePermissions === "allowAll";
}

/** Experimental Grok Build vendor UI (model + reasoning effort). Default off. */
export function experimentalGrokVendorUi(settings: PanelSettings): boolean {
  return settings.acp?.experimentalGrokVendorUi === true;
}
