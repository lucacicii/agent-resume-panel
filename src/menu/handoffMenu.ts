import { AcpAgentProvider } from "../acp/types";
import { HandoffTargetProvider } from "../handoff/types";
import { ACP_HANDOFF_TARGETS, CLI_HANDOFF_TARGETS, HANDOFF_TARGET_META } from "../handoff/targets";

export const HANDOFF_SUBMENU_ID = "agentResume.handoffTo";

export function handoffCommandId(provider: HandoffTargetProvider | AcpAgentProvider): string {
  return `agentResume.handoffTo.${provider}`;
}

export { CLI_HANDOFF_TARGETS, ACP_HANDOFF_TARGETS };

export function handoffTargetLabel(provider: HandoffTargetProvider | AcpAgentProvider): string {
  return HANDOFF_TARGET_META[provider as HandoffTargetProvider]?.label ?? provider;
}

export function handoffCommandTitle(provider: HandoffTargetProvider | AcpAgentProvider): string {
  return `Hand Off to ${handoffTargetLabel(provider)}`;
}