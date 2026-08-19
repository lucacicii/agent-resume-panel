import { BrowserWindow } from "electron";
import { safeHandle } from "../ipcUtils";
import { BrowserController } from "./controller";
import { getBrowserWindow, listBrowserWindows } from "./window";
import type {
  BrowserCreateArgs,
  BrowserEvent,
  BrowserPolicy,
  BrowserRect,
  BrowserSessionId,
  BrowserSurfaceKind,
  BrowserTabId
} from "./types";

export type RegisterBrowserIpcDeps = {
  getMainWindow: () => BrowserWindow | null;
  getPreloadPath: () => string;
  getIcon?: () => Electron.NativeImage | undefined;
  getPartitionMode?: () => "per-project" | "shared";
  getDefaultPolicy?: () => BrowserPolicy | undefined;
  getDefaultSurface?: () => BrowserSurfaceKind | "last-used";
};

let controller: BrowserController | null = null;

function windowIdFromEvent(event: Electron.IpcMainInvokeEvent): number | undefined {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win && !win.isDestroyed() ? win.id : undefined;
}

function broadcastBrowserEvent(
  getMainWindow: () => BrowserWindow | null,
  event: BrowserEvent
): void {
  const targets = new Set<BrowserWindow>();
  const main = getMainWindow();
  if (main && !main.isDestroyed()) targets.add(main);
  for (const win of listBrowserWindows()) targets.add(win);

  // Also include the standalone window for the specific browserId when present.
  if ("browserId" in event && typeof event.browserId === "string") {
    const win = getBrowserWindow(event.browserId);
    if (win) targets.add(win);
  }
  if (event.type === "state") {
    const win = getBrowserWindow(event.session.id);
    if (win) targets.add(win);
  }

  for (const win of targets) {
    if (win.isDestroyed()) continue;
    try {
      win.webContents.send("browser:event", event);
    } catch {
      // ignore
    }
  }
}

export function getBrowserController(): BrowserController | null {
  return controller;
}

export function registerBrowserIpc(deps: RegisterBrowserIpcDeps): BrowserController {
  controller = new BrowserController({
    getMainWindow: deps.getMainWindow,
    getPreloadPath: deps.getPreloadPath,
    getIcon: deps.getIcon,
    getPartitionMode: deps.getPartitionMode,
    getDefaultPolicy: deps.getDefaultPolicy,
    getDefaultSurface: deps.getDefaultSurface,
    broadcast: (event) => broadcastBrowserEvent(deps.getMainWindow, event)
  });

  const c = controller;

  safeHandle("browser:create", async (event, args: BrowserCreateArgs) => {
    return c.create(args || { projectPath: "" }, windowIdFromEvent(event));
  });

  safeHandle("browser:destroy", async (_event, args: { browserId: BrowserSessionId }) => {
    return c.destroy(args?.browserId);
  });

  safeHandle("browser:list", async () => c.list());

  safeHandle("browser:get", async (_event, args: { browserId: BrowserSessionId }) => {
    return c.get(args?.browserId);
  });

  safeHandle(
    "browser:attachBounds",
    async (
      event,
      args: { browserId: BrowserSessionId; rect: BrowserRect; windowId?: number }
    ) => {
      const windowId = args?.windowId ?? windowIdFromEvent(event);
      if (windowId == null) return { ok: false };
      return c.attachBounds(args.browserId, args.rect, windowId);
    }
  );

  safeHandle(
    "browser:setVisible",
    async (_event, args: { browserId: BrowserSessionId; visible: boolean }) => {
      return c.setVisible(args.browserId, Boolean(args?.visible));
    }
  );

  safeHandle(
    "browser:setSurface",
    async (
      _event,
      args: { browserId: BrowserSessionId; surface: BrowserSurfaceKind; bounds?: BrowserRect }
    ) => {
      return c.setSurface(args.browserId, args.surface, args.bounds);
    }
  );

  safeHandle("browser:focus", async (_event, args: { browserId: BrowserSessionId }) => {
    return c.focus(args?.browserId);
  });

  safeHandle(
    "browser:navigate",
    async (_event, args: { browserId: BrowserSessionId; url: string; tabId?: BrowserTabId }) => {
      return c.navigate(args.browserId, args.url, args.tabId);
    }
  );

  safeHandle(
    "browser:back",
    async (_event, args: { browserId: BrowserSessionId; tabId?: BrowserTabId }) => {
      return c.back(args.browserId, args.tabId);
    }
  );

  safeHandle(
    "browser:forward",
    async (_event, args: { browserId: BrowserSessionId; tabId?: BrowserTabId }) => {
      return c.forward(args.browserId, args.tabId);
    }
  );

  safeHandle(
    "browser:reload",
    async (_event, args: { browserId: BrowserSessionId; tabId?: BrowserTabId }) => {
      return c.reload(args.browserId, args.tabId);
    }
  );

  safeHandle(
    "browser:stop",
    async (_event, args: { browserId: BrowserSessionId; tabId?: BrowserTabId }) => {
      return c.stop(args.browserId, args.tabId);
    }
  );

  safeHandle(
    "browser:newTab",
    async (_event, args: { browserId: BrowserSessionId; url?: string }) => {
      return c.newTab(args.browserId, args.url);
    }
  );

  safeHandle(
    "browser:closeTab",
    async (_event, args: { browserId: BrowserSessionId; tabId: BrowserTabId }) => {
      try {
        return { session: c.closeTab(args.browserId, args.tabId), destroyed: false };
      } catch (error) {
        if (error instanceof Error && error.message === "SESSION_DESTROYED") {
          return { session: null, destroyed: true };
        }
        throw error;
      }
    }
  );

  safeHandle(
    "browser:activateTab",
    async (_event, args: { browserId: BrowserSessionId; tabId: BrowserTabId }) => {
      return c.activateTab(args.browserId, args.tabId);
    }
  );

  safeHandle(
    "browser:setPolicy",
    async (_event, args: { browserId: BrowserSessionId; policy: Partial<BrowserPolicy> }) => {
      return c.setPolicy(args.browserId, args.policy || {});
    }
  );

  safeHandle(
    "browser:clearCookies",
    async (_event, args: { browserId: BrowserSessionId; hosts?: string[] }) => {
      return c.clearCookies(args.browserId, args.hosts);
    }
  );

  return c;
}

export function disposeBrowserController(): void {
  controller?.disposeAll();
  controller = null;
}
