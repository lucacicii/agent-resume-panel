import { runStdioServer } from "@agent-resume/core";
import { EXTERNAL_MCP_SERVICE_ID } from "./mcpRegistration";

const MCP_FLAG = "--agent-resume-mcp";

export function parseMcpRunnerArgs(args: string[]): { serviceId: string; panelHome?: string } | null {
  const flagIndex = args.indexOf(MCP_FLAG);
  if (flagIndex < 0) return null;
  const serviceId = args[flagIndex + 1];
  if (!serviceId) throw new Error("Missing MCP service id.");
  return { serviceId, panelHome: process.env.AGENT_RESUME_PANEL_HOME || undefined };
}

export async function runDesktopMcpService(invocation: { serviceId: string; panelHome?: string }): Promise<void> {
  if (invocation.serviceId !== EXTERNAL_MCP_SERVICE_ID) {
    throw new Error(`Unknown MCP service: ${invocation.serviceId}`);
  }
  await runStdioServer(invocation.panelHome);
}
