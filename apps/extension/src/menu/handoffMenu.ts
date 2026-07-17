import { AcpAgentProvider } from "../acp/types";
import { HandoffTargetProvider } from "../handoff/types";
import { t } from "../i18n";
import { ACP_HANDOFF_TARGETS, CLI_HANDOFF_TARGETS, getHandoffTargetLabel } from "../handoff/targets";

export const HANDOFF_SUBMENU_ID = "agentResume.handoffTo";

export function handoffCommandId(provider: HandoffTargetProvider | AcpAgentProvider): string {
  return `agentResume.handoffTo.${provider}`;
}

export { CLI_HANDOFF_TARGETS, ACP_HANDOFF_TARGETS };

export function handoffTargetLabel(provider: HandoffTargetProvider | AcpAgentProvider): string {
  if ((CLI_HANDOFF_TARGETS as readonly string[]).includes(provider)) {
    return getHandoffTargetLabel(provider as HandoffTargetProvider);
  }
  return provider;
}

export function handoffCommandTitle(provider: HandoffTargetProvider | AcpAgentProvider): string {
  return t("menu.handoff.commandTitle", handoffTargetLabel(provider));
}