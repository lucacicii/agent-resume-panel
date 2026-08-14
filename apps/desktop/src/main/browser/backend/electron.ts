import { WebContentsView, session as electronSession, type Session } from "electron";
import { isNavigationAllowed } from "../policy";
import type { BrowserPolicy, BrowserTabId, BrowserTabState } from "../types";
import { normalizeUrlInput } from "../types";

export type TabViewHooks = {
  onTabState: (tabId: BrowserTabId, patch: Partial<BrowserTabState>) => void;
  onConsole?: (tabId: BrowserTabId, level: string, message: string) => void;
  getPolicy: () => BrowserPolicy;
};

export type ElectronTabView = {
  tabId: BrowserTabId;
  view: WebContentsView;
  dispose: () => void;
  navigate: (url: string) => void;
  back: () => void;
  forward: () => void;
  reload: () => void;
  stop: () => void;
  snapshotState: () => BrowserTabState;
};

function titleFromUrl(url: string): string {
  if (!url || url === "about:blank") return "New Tab";
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

export function createPartitionSession(partition: string): Session {
  return electronSession.fromPartition(partition);
}

export function createElectronTabView(args: {
  tabId: BrowserTabId;
  partition: string;
  startUrl?: string;
  hooks: TabViewHooks;
}): ElectronTabView {
  const ses = createPartitionSession(args.partition);
  const view = new WebContentsView({
    webPreferences: {
      session: ses,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: true
    }
  });

  let disposed = false;
  let currentUrl = normalizeUrlInput(args.startUrl || "about:blank");
  let currentTitle = titleFromUrl(currentUrl);
  let loading = false;

  const emit = () => {
    if (disposed) return;
    args.hooks.onTabState(args.tabId, {
      url: currentUrl,
      title: currentTitle,
      loading,
      canGoBack: view.webContents.navigationHistory.canGoBack(),
      canGoForward: view.webContents.navigationHistory.canGoForward()
    });
  };

  const wc = view.webContents;
  wc.setWindowOpenHandler(() => {
    const policy = args.hooks.getPolicy();
    if (!policy.allowPopups) return { action: "deny" };
    return { action: "deny" }; // v1: no extra windows; navigate active tab instead later
  });

  wc.on("did-start-loading", () => {
    loading = true;
    emit();
  });
  wc.on("did-stop-loading", () => {
    loading = false;
    currentUrl = wc.getURL() || currentUrl;
    currentTitle = wc.getTitle() || titleFromUrl(currentUrl);
    emit();
  });
  wc.on("page-title-updated", (_event, title) => {
    currentTitle = title || titleFromUrl(currentUrl);
    emit();
  });
  wc.on("did-navigate", (_event, url) => {
    currentUrl = url || currentUrl;
    emit();
  });
  wc.on("did-navigate-in-page", (_event, url) => {
    currentUrl = url || currentUrl;
    emit();
  });
  wc.on("will-navigate", (event, url) => {
    const decision = isNavigationAllowed(args.hooks.getPolicy(), url);
    if (!decision.allowed) {
      event.preventDefault();
    }
  });
  wc.on("console-message", (_event, level, message) => {
    args.hooks.onConsole?.(args.tabId, String(level), String(message));
  });
  wc.on("render-process-gone", (_event, details) => {
    loading = false;
    currentTitle = `Crashed (${details.reason})`;
    emit();
  });

  const navigate = (url: string) => {
    const next = normalizeUrlInput(url);
    const decision = isNavigationAllowed(args.hooks.getPolicy(), next);
    if (!decision.allowed && next !== "about:blank") {
      return;
    }
    currentUrl = next;
    loading = true;
    emit();
    void wc.loadURL(next).catch(() => {
      loading = false;
      emit();
    });
  };

  if (currentUrl && currentUrl !== "about:blank") {
    navigate(currentUrl);
  } else {
    void wc.loadURL("about:blank");
  }

  return {
    tabId: args.tabId,
    view,
    navigate,
    back: () => {
      if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    },
    forward: () => {
      if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    },
    reload: () => wc.reload(),
    stop: () => wc.stop(),
    snapshotState: () => ({
      tabId: args.tabId,
      url: currentUrl,
      title: currentTitle,
      loading,
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward()
    }),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      try {
        const parent = view.webContents.isDestroyed() ? null : null;
        void parent;
        // Parent detach is controller's job; destroy contents here.
        if (!wc.isDestroyed()) {
          (wc as Electron.WebContents & { destroy?: () => void }).destroy?.();
        }
      } catch {
        // ignore
      }
    }
  };
}
