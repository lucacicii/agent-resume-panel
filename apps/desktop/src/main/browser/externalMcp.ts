import {
  effectivePanelHome,
  type PanelSettings
} from "@agent-resume/core";
import { getBrowserController } from "./ipc";
import { ensureBrowserMcpServer } from "./mcpServer";
import {
  createExternalBrowserMcpLaunchConfig,
  registerBrowserMcpClient,
  removeBrowserMcpClient,
  resolveExternalBrowserMcpCliPath,
  type McpClientId
} from "../mcpRegistration";
import { app } from "electron";

const AUTO_CLIENTS: McpClientId[] = ["claude", "codex", "gemini", "antigravity", "opencode"];

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

function browserLaunchFromRuntime(settings: PanelSettings) {
  return createExternalBrowserMcpLaunchConfig({
    executablePath: process.execPath,
    cliPath: resolveExternalBrowserMcpCliPath({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath()
    }),
    panelHome: effectivePanelHome(settings)
  });
}

/**
 * Register or remove `agent-resume-browser` on automatic MCP clients based on settings.
 * Best-effort: failures are logged, not thrown (Desktop must still start).
 */
export async function syncBrowserExternalMcpRegistration(settings: PanelSettings): Promise<{
  registered: string[];
  removed: string[];
  failed: Array<{ target: string; error: string }>;
}> {
  const registered: string[] = [];
  const removed: string[] = [];
  const failed: Array<{ target: string; error: string }> = [];
  const browser = settings.desktop?.browser;
  const want =
    Boolean(browser?.enabled) && browser?.exposeExternalMcp !== false;

  if (want) {
    try {
      await ensureBrowserMcpReadyForExternal(settings);
    } catch (error) {
      failed.push({
        target: "endpoint",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  let launch: ReturnType<typeof browserLaunchFromRuntime> | null = null;
  if (want) {
    try {
      launch = browserLaunchFromRuntime(settings);
    } catch (error) {
      failed.push({
        target: "launch-config",
        error: error instanceof Error ? error.message : String(error)
      });
      return { registered, removed, failed };
    }
  }

  for (const clientId of AUTO_CLIENTS) {
    try {
      if (want && launch) {
        await registerBrowserMcpClient(clientId, launch, true);
        registered.push(clientId);
      } else {
        await removeBrowserMcpClient(clientId);
        removed.push(clientId);
      }
    } catch (error) {
      // Missing CLI / not detected is normal — don't treat as hard failure noise.
      const message = error instanceof Error ? error.message : String(error);
      if (/not found|was not found|Unable to resolve/i.test(message)) {
        continue;
      }
      failed.push({ target: clientId, error: message });
    }
  }

  return { registered, removed, failed };
}
