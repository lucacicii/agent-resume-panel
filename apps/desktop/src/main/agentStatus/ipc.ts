/**
 * Renderer-facing status surface.
 *
 * The renderer is a pure consumer: it asks for the current snapshot once on
 * mount and then receives pushes. It never probes anything itself. The same
 * channel also carries the settings actions (install the hook for an agent,
 * start/stop the daemon) and the diagnostics reads (`status.explain`,
 * `pane.screen`) that power the inspector.
 */

import type { BrowserWindow } from "electron";
import type { DetectionExplain, PaneScreenDump } from "../../shared/agentStatusTypes";
import { safeHandle } from "../ipcUtils";
import type { AgentStatusBridge } from "./bridge";
import { connectAgentStatusClient } from "./client";
import { readEndpointFile } from "./endpoint";
import {
  installAgentIntegration,
  listAgentIntegrations,
  uninstallAgentIntegration,
  type AgentIntegrationContext,
  type AgentIntegrationId
} from "./integrations";
import {
  ensureAgentStatusDaemon,
  isAgentStatusLaunchAgentInstalled,
  readAgentStatusDaemonStatus,
  resolveAgentStatusCliPath,
  resolveDaemonEntryPath,
  stopAgentStatusDaemon,
  type AgentStatusDaemonStatus
} from "./lifecycle";
import { agentStatusPaths } from "./paths";

/** Renderer channel carrying `StatusSnapshot` pushes. */
export const AGENT_STATUS_CHANGED_CHANNEL = "agentStatus:changed";

export type AgentStatusIpcContext = {
  getWindow: () => BrowserWindow | null;
  bridge: AgentStatusBridge;
  /** Resolved lazily: the panel home is a setting and can change at runtime. */
  getPanelHome: () => string;
  execPath: string;
  appVersion: string;
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
};

export function registerAgentStatusIpc(deps: AgentStatusIpcContext): void {
  safeHandle("agentStatus:getSnapshot", () => deps.bridge.getSnapshot());

  deps.bridge.subscribe((snapshot) => {
    const win = deps.getWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.send(AGENT_STATUS_CHANGED_CHANNEL, snapshot);
  });

  const integrationContext = (): AgentIntegrationContext => ({
    panelHome: deps.getPanelHome(),
    execPath: deps.execPath,
    cliPath: resolveAgentStatusCliPath({
      isPackaged: deps.isPackaged,
      resourcesPath: deps.resourcesPath,
      appPath: deps.appPath
    })
  });

  const bundleEntry = (): string =>
    resolveDaemonEntryPath({
      isPackaged: deps.isPackaged,
      resourcesPath: deps.resourcesPath,
      appPath: deps.appPath
    });

  /**
   * One short-lived diagnostics request.
   *
   * The bridge owns the long-lived connection for status pushes; opening a
   * separate connection means a slow request can never delay them.
   */
  const askDaemon = async <T>(method: string, params: unknown): Promise<T | null> => {
    const paths = agentStatusPaths(deps.getPanelHome());
    const endpoint = await readEndpointFile(paths);
    if (!endpoint) return null;
    const client = await connectAgentStatusClient({
      socketPath: endpoint.socketPath,
      role: "app",
      connectTimeoutMs: 800
    });
    try {
      return await client.request<T>(method, params);
    } finally {
      client.close();
    }
  };

  const readStatus = async (): Promise<AgentStatusDaemonStatus> => {
    const panelHome = deps.getPanelHome();
    const status = await readAgentStatusDaemonStatus(panelHome);
    return {
      ...status,
      launchAgentInstalled: await isAgentStatusLaunchAgentInstalled().catch(() => false)
    };
  };

  safeHandle("agentStatus:listIntegrations", () => listAgentIntegrations(integrationContext()));

  safeHandle("agentStatus:installIntegration", (_event, args: { id?: unknown }) => {
    const id = args?.id;
    if (id !== "claude" && id !== "codex" && id !== "pi") throw new Error("Unknown integration.");
    return installAgentIntegration(integrationContext(), id as AgentIntegrationId);
  });

  safeHandle("agentStatus:uninstallIntegration", (_event, args: { id?: unknown }) => {
    const id = args?.id;
    if (id !== "claude" && id !== "codex" && id !== "pi") throw new Error("Unknown integration.");
    return uninstallAgentIntegration(integrationContext(), id as AgentIntegrationId);
  });

  safeHandle("agentStatus:daemonStatus", readStatus);

  safeHandle("agentStatus:startDaemon", async () => {
    const panelHome = deps.getPanelHome();
    await ensureAgentStatusDaemon({
      panelHome,
      execPath: deps.execPath,
      entryPath: bundleEntry(),
      appVersion: deps.appVersion,
      notify: deps.isPackaged
    });
    deps.bridge.reconnect();
    return readStatus();
  });

  safeHandle("agentStatus:stopDaemon", async () => {
    await stopAgentStatusDaemon(deps.getPanelHome());
    return readStatus();
  });

  safeHandle("agentStatus:explain", (_event, args: { paneId?: unknown }) => {
    const paneId = Number(args?.paneId);
    if (!Number.isInteger(paneId)) throw new Error("Invalid paneId.");
    return askDaemon<DetectionExplain | null>("status.explain", { paneId });
  });

  safeHandle("agentStatus:screen", (_event, args: { paneId?: unknown }) => {
    const paneId = Number(args?.paneId);
    if (!Number.isInteger(paneId)) throw new Error("Invalid paneId.");
    return askDaemon<PaneScreenDump | null>("pane.screen", { paneId });
  });

  safeHandle("agentStatus:panes", async () => {
    const snapshot = await askDaemon<{ byPaneId: Record<string, unknown> }>("status.snapshot", {});
    return snapshot ? Object.values(snapshot.byPaneId) : [];
  });
}
