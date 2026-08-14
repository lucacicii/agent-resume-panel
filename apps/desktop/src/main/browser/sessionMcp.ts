import { effectivePanelHome, type PanelSettings } from "@agent-resume/core";
import type { McpServer } from "@agentclientprotocol/sdk" with { "resolution-mode": "import" };
import { BROWSER_MCP_SERVER_NAME, ensureBrowserMcpServer, type BrowserMcpServerHandle } from "./mcpServer";
import type { BrowserController } from "./controller";

export type SessionMcpBuildArgs = {
  projectPath: string;
  recordId: string;
  settings: PanelSettings;
  controller: BrowserController | null;
};

/**
 * Generic seam for desktop-local MCP servers injected into ACP session/new + restore.
 * Browser is the first consumer.
 */
export async function buildSessionMcpServers(args: SessionMcpBuildArgs): Promise<McpServer[]> {
  const servers: McpServer[] = [];
  const browser = args.settings.desktop?.browser;
  if (!browser?.enabled) return servers;
  if (!browser.injectIntoAcpSessions) return servers;
  if (!args.controller) return servers;

  let handle: BrowserMcpServerHandle;
  try {
    handle = await ensureBrowserMcpServer(args.controller, {
      panelHome: effectivePanelHome(args.settings),
      // Endpoint file is for external TUI proxy; publish whenever external exposure is on.
      publishEndpoint: browser.exposeExternalMcp !== false
    });
  } catch (error) {
    console.warn(
      "[browser-mcp] failed to start local server:",
      error instanceof Error ? error.message : String(error)
    );
    return servers;
  }

  servers.push({
    type: "http",
    name: BROWSER_MCP_SERVER_NAME,
    url: handle.url,
    headers: [
      { name: "Authorization", value: `Bearer ${handle.token}` },
      { name: "X-Agent-Resume-Project", value: args.projectPath },
      { name: "X-Agent-Resume-Record", value: args.recordId }
    ]
  });

  return servers;
}
