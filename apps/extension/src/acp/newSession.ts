import { panelHomeFromConfig, pickAcpAgentProvider } from "./config";
import { createAcpRecord } from "./store";
import { AcpAgentProvider } from "./types";

export async function createAcpChatSession(projectPath: string, provider: AcpAgentProvider) {
  return createAcpRecord(panelHomeFromConfig(), projectPath, provider);
}

export { pickAcpAgentProvider, panelHomeFromConfig };