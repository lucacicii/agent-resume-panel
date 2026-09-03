import { getLiveAcpAgentModels, probeAcpAgentModels } from "../acp/acpHost";
import type { ImAgent, ImAgentModelOption } from "./types";

/**
 * Resolves the model list for an IM Agent from the ACP agent itself:
 * live ACP sessions expose their real models through config options.
 * With `refresh`, a short-lived probe session discovers them on demand.
 */
export async function resolveAgentModels(
  agent: ImAgent,
  options?: { refresh?: boolean }
): Promise<ImAgentModelOption[]> {
  const source = options?.refresh ? await probeAcpAgentModels(agent) : getLiveAcpAgentModels(agent);
  return source.map((m) => ({ id: m.id, label: m.label || m.id, provider: "ACP" }));
}
