import { effectivePanelHome, type PanelSettings } from "@agent-resume/core";
import { getBrowserController } from "./ipc";
import { ensureBrowserMcpServer } from "./mcpServer";

/**
 * Ensure loopback browser MCP is up and endpoint file is published for TUI proxies.
 */
export async function ensureBrowserMcpReadyForExternal(settings: PanelSettings): Promise<void> {
  const browser = settings.desktop?.browser;
  if (!browser?.enabled) return;
  if (browser.exposeExternalMcp === false) return;
  const controller = getBrowserController();
  if (!controller) return;
  await ensureBrowserMcpServer(controller, {
    panelHome: effectivePanelHome(settings),
    publishEndpoint: true
  });
}
