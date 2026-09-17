import { effectivePanelHome, resolvePanelHome, type PanelSettings } from "@agent-resume/core";
import { app } from "electron";
import { ensureBrowserMcpReadyForExternal } from "./browser/externalMcp";
import {
  createExternalBrowserMcpLaunchConfig,
  createExternalMcpLaunchConfig,
  registerBrowserMcpClient,
  registerMcpClient,
  removeBrowserMcpClient,
  resolveExternalBrowserMcpCliPath,
  resolveExternalMcpCliPath,
  type McpClientId
} from "./mcpRegistration";

/**
 * Clients the app registers without asking. Cursor / Pi / Grok Build stay manual
 * (Desktop does not guess their MCP config locations).
 */
export const AUTO_MCP_CLIENTS: McpClientId[] = [
  "claude",
  "codex",
  "gemini",
  "antigravity",
  "opencode"
];

export interface ExternalMcpSyncResult {
  registered: string[];
  removed: string[];
  failed: Array<{ target: string; error: string }>;
}

function coreLaunch(settings: PanelSettings) {
  return createExternalMcpLaunchConfig({
    executablePath: process.execPath,
    cliPath: resolveExternalMcpCliPath({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath()
    }),
    panelHome: resolvePanelHome(settings.panelHome)
  });
}

function browserLaunch(settings: PanelSettings) {
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
 * Keep the two Agent Resume MCP services (`agent-resume` data + `agent-resume-browser`)
 * in step with settings on every automatic client.
 *
 * The data service is always registered. The browser service follows
 * `desktop.browser.enabled` and `desktop.browser.exposeExternalMcp`.
 * Best-effort: failures are reported, never thrown (Desktop must still start).
 */
export async function syncExternalMcpRegistration(settings: PanelSettings): Promise<ExternalMcpSyncResult> {
  const registered: string[] = [];
  const removed: string[] = [];
  const failed: Array<{ target: string; error: string }> = [];

  const browser = settings.desktop?.browser;
  const wantBrowser = Boolean(browser?.enabled) && browser?.exposeExternalMcp !== false;

  if (wantBrowser) {
    try {
      await ensureBrowserMcpReadyForExternal(settings);
    } catch (error) {
      failed.push({
        target: "endpoint",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const core = coreLaunch(settings);
  const browserCfg = wantBrowser ? browserLaunch(settings) : null;

  for (const clientId of AUTO_MCP_CLIENTS) {
    try {
      await registerMcpClient(clientId, core, true);
      registered.push(`${clientId}:agent-resume`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Missing CLI / not detected is normal — don't treat as hard failure noise.
      if (!/not found|was not found|Unable to resolve/i.test(message)) {
        failed.push({ target: `${clientId}:agent-resume`, error: message });
      }
    }

    try {
      if (browserCfg) {
        await registerBrowserMcpClient(clientId, browserCfg, true);
        registered.push(`${clientId}:agent-resume-browser`);
      } else {
        await removeBrowserMcpClient(clientId);
        removed.push(`${clientId}:agent-resume-browser`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/not found|was not found|Unable to resolve/i.test(message)) {
        failed.push({ target: `${clientId}:agent-resume-browser`, error: message });
      }
    }
  }

  return { registered, removed, failed };
}
