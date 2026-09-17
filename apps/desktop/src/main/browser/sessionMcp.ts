import { effectivePanelHome, MCP_SESSION_ENV, type PanelSettings } from "@agent-resume/core";
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

  // 1. Core Data MCP Server (notes, reports, sessions, projects, link_graph, tags)
  try {
    const { app } = await import("electron");
    const { resolveExternalMcpCliPath } = await import("../mcpRegistration");
    const cliPath = resolveExternalMcpCliPath({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath()
    });
    const panelHome = effectivePanelHome(args.settings);
    const env: Array<{ name: string; value: string }> = [
      { name: "ELECTRON_RUN_AS_NODE", value: "1" },
      { name: "AGENT_RESUME_PANEL_HOME", value: panelHome }
    ];
    // ACP chat sessions appear in the catalog as provider "chat" with the ACP
    // record id as the session id, so note tools can resolve the work item this
    // session is linked to (or fall back to the session itself).
    if (args.recordId && args.recordId !== "unknown") {
      env.push(
        { name: MCP_SESSION_ENV.provider, value: "chat" },
        { name: MCP_SESSION_ENV.sessionId, value: args.recordId }
      );
    }
    servers.push({
      name: "agent-resume",
      command: process.execPath,
      args: [cliPath],
      env
    });
  } catch (error) {
    console.warn(
      "[acp-mcp] failed to configure core agent-resume MCP server:",
      error instanceof Error ? error.message : String(error)
    );
  }

  // 2. Browser MCP Server
  const browser = args.settings.desktop?.browser;
  if (!browser?.enabled || browser.injectIntoAcpSessions === false || !args.controller) {
    return servers;
  }

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
