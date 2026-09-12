/**
 * Renderer-facing status surface.
 *
 * The renderer is a pure consumer: it asks for the current snapshot once on
 * mount and then receives pushes. It never probes anything itself.
 */

import type { BrowserWindow } from "electron";
import { safeHandle } from "../ipcUtils";
import type { AgentStatusBridge } from "./bridge";

/** Renderer channel carrying `StatusSnapshot` pushes. */
export const AGENT_STATUS_CHANGED_CHANNEL = "agentStatus:changed";

export function registerAgentStatusIpc(deps: {
  getWindow: () => BrowserWindow | null;
  bridge: AgentStatusBridge;
}): void {
  safeHandle("agentStatus:getSnapshot", () => deps.bridge.getSnapshot());
  deps.bridge.subscribe((snapshot) => {
    const win = deps.getWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.send(AGENT_STATUS_CHANGED_CHANNEL, snapshot);
  });
}
