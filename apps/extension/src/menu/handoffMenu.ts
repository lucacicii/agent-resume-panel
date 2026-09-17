import { AcpAgentProvider } from "../acp/types";
import { HandoffTargetProvider } from "../handoff/types";
import { ACP_HANDOFF_TARGETS, CLI_HANDOFF_TARGETS } from "../handoff/targets";

export const HANDOFF_SUBMENU_ID = "agentResume.handoffTo";

export function handoffCommandId(provider: HandoffTargetProvider | AcpAgentProvider): string {
  return `agentResume.handoffTo.${provider}`;
}

export { CLI_HANDOFF_TARGETS, ACP_HANDOFF_TARGETS };

