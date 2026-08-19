import { BrowserWindow, type BrowserWindowConstructorOptions } from "electron";
import * as path from "node:path";
import type { BrowserSessionId } from "./types";

export type BrowserWindowEntry = {
  browserId: BrowserSessionId;
  window: BrowserWindow;
};

const windows = new Map<BrowserSessionId, BrowserWindowEntry>();
const boundsByBrowserId = new Map<BrowserSessionId, Electron.Rectangle>();

const DEFAULT_SIZE = { width: 1100, height: 780 } as const;

export function getBrowserWindow(browserId: BrowserSessionId): BrowserWindow | null {
  const entry = windows.get(browserId);
  if (!entry || entry.window.isDestroyed()) {
    windows.delete(browserId);
    return null;
  }
  return entry.window;
}

export function listBrowserWindows(): BrowserWindow[] {
  const out: BrowserWindow[] = [];
  for (const [id, entry] of windows) {
    if (entry.window.isDestroyed()) {
      windows.delete(id);
      continue;
    }
    out.push(entry.window);
  }
  return out;
}

export function getOrCreateBrowserWindow(args: {
  browserId: BrowserSessionId;
  preloadPath: string;
  icon?: Electron.NativeImage;
  onClosed: (browserId: BrowserSessionId) => void;
  title?: string;
}): BrowserWindow {
  const existing = getBrowserWindow(args.browserId);
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return existing;
  }

  const saved = boundsByBrowserId.get(args.browserId);
  const options: BrowserWindowConstructorOptions = {
    ...(saved || DEFAULT_SIZE),
    minWidth: 640,
    minHeight: 480,
    title: args.title || "Browser",
    show: false,
    ...(args.icon ? { icon: args.icon } : {}),
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: process.platform === "darwin" ? { x: 14, y: 14 } : undefined,
    webPreferences: {
      preload: args.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  };

  const win = new BrowserWindow(options);
  if (process.platform !== "darwin") {
    win.setMenuBarVisibility(false);
  }

  windows.set(args.browserId, { browserId: args.browserId, window: win });

  win.on("resize", () => {
    if (!win.isDestroyed()) boundsByBrowserId.set(args.browserId, win.getBounds());
  });
  win.on("move", () => {
    if (!win.isDestroyed()) boundsByBrowserId.set(args.browserId, win.getBounds());
  });
  win.on("closed", () => {
    windows.delete(args.browserId);
    args.onClosed(args.browserId);
  });

  void win.loadFile(path.join(__dirname, "..", "..", "renderer", "index.html"), {
    query: { mode: "browser", browserId: args.browserId }
  });

  win.once("ready-to-show", () => {
    if (!win.isDestroyed()) {
      win.show();
      win.focus();
    }
  });

  return win;
}

export function closeBrowserWindow(browserId: BrowserSessionId): void {
  const win = getBrowserWindow(browserId);
  if (win && !win.isDestroyed()) win.close();
}

export function contentBoundsForWindow(win: BrowserWindow): Electron.Rectangle {
  const [width, height] = win.getContentSize();
  // Leave room for chrome toolbar (~52px) drawn by renderer.
  const chromeHeight = 52;
  return {
    x: 0,
    y: chromeHeight,
    width: Math.max(1, width),
    height: Math.max(1, height - chromeHeight)
  };
}
