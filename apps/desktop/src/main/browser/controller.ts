import { createHash, randomUUID } from "node:crypto";
import {
  BrowserWindow,
  type WebContentsView
} from "electron";
import { createElectronTabView, type ElectronTabView } from "./backend/electron";
import {
  closeBrowserWindow,
  contentBoundsForWindow,
  getBrowserWindow,
  getOrCreateBrowserWindow
} from "./window";
import {
  DEFAULT_BROWSER_POLICY,
  type BrowserCreateArgs,
  type BrowserEvent,
  type BrowserOwner,
  type BrowserPolicy,
  type BrowserRect,
  type BrowserSessionId,
  type BrowserSessionState,
  type BrowserSurface,
  type BrowserSurfaceKind,
  type BrowserTabId,
  type BrowserTabState
} from "./types";

export type BrowserControllerDeps = {
  getMainWindow: () => BrowserWindow | null;
  getPreloadPath: () => string;
  getIcon?: () => Electron.NativeImage | undefined;
  getPartitionMode?: () => "per-project" | "shared";
  getDefaultPolicy?: () => BrowserPolicy | undefined;
  getDefaultSurface?: () => BrowserSurfaceKind | "last-used";
  broadcast: (event: BrowserEvent) => void;
};

type InternalSession = {
  state: BrowserSessionState;
  tabs: Map<BrowserTabId, ElectronTabView>;
  /** Last workbench bounds reported by renderer (for reattach). */
  workbenchBounds: BrowserRect | null;
  /** Whether the workbench host currently wants the view visible. */
  workbenchVisible: boolean;
};

function projectHash(projectPath: string): string {
  return createHash("sha256").update(projectPath).digest("hex").slice(0, 12);
}

function partitionFor(projectPath: string, mode: "per-project" | "shared"): string {
  if (mode === "shared") return "persist:agent-browser";
  return `persist:agent-browser:${projectHash(projectPath || "default")}`;
}

function cloneState(state: BrowserSessionState): BrowserSessionState {
  return {
    ...state,
    tabs: state.tabs.map((tab) => ({ ...tab })),
    owners: state.owners.map((owner) => ({ ...owner })),
    policy: {
      ...state.policy,
      allowHosts: [...state.policy.allowHosts],
      blockHosts: [...state.policy.blockHosts]
    },
    surface: { ...state.surface }
  };
}

export class BrowserController {
  private readonly sessions = new Map<BrowserSessionId, InternalSession>();
  private lastUsedSurface: BrowserSurfaceKind = "workbench";

  constructor(private readonly deps: BrowserControllerDeps) {}

  list(): BrowserSessionState[] {
    return [...this.sessions.values()].map((session) => cloneState(session.state));
  }

  get(browserId: BrowserSessionId): BrowserSessionState | null {
    const session = this.sessions.get(browserId);
    return session ? cloneState(session.state) : null;
  }

  create(args: BrowserCreateArgs, preferredWindowId?: number): BrowserSessionState {
    const projectPath = (args.projectPath || "").trim() || "unknown";
    const mode = this.deps.getPartitionMode?.() || "per-project";
    const policy = {
      ...DEFAULT_BROWSER_POLICY,
      ...(this.deps.getDefaultPolicy?.() || {})
    };
    const surfaceKind = this.resolveInitialSurface(args.surface);
    const browserId = randomUUID();
    const tabId = randomUUID();
    const partition = partitionFor(projectPath, mode);

    const hostWindow = this.resolveHostWindow(surfaceKind, preferredWindowId);
    if (!hostWindow) {
      throw new Error("No host window available for browser session.");
    }

    const surface: BrowserSurface = {
      kind: surfaceKind,
      windowId: hostWindow.id
    };

    const owners: BrowserOwner[] = args.boundRecordId
      ? [{ kind: "acp", recordId: args.boundRecordId }]
      : [];

    const initialTab: BrowserTabState = {
      tabId,
      url: args.startUrl?.trim() || "about:blank",
      title: "New Tab",
      loading: false,
      canGoBack: false,
      canGoForward: false
    };

    const state: BrowserSessionState = {
      id: browserId,
      projectPath,
      partition,
      tabs: [initialTab],
      activeTabId: tabId,
      createdAt: Date.now(),
      surface,
      owners,
      policy
    };

    const internal: InternalSession = {
      state,
      tabs: new Map(),
      workbenchBounds: null,
      workbenchVisible: surfaceKind === "workbench"
    };
    this.sessions.set(browserId, internal);

    const tabView = this.spawnTab(internal, tabId, args.startUrl);
    internal.tabs.set(tabId, tabView);

    if (surfaceKind === "window") {
      this.ensureStandaloneWindow(browserId, projectPath);
      const win = getBrowserWindow(browserId);
      if (win) {
        this.attachActiveView(internal, win, contentBoundsForWindow(win));
        internal.state.surface = { kind: "window", windowId: win.id };
      }
    } else {
      // Workbench host attaches when renderer reports bounds.
      this.detachActiveView(internal);
    }

    this.lastUsedSurface = surfaceKind;
    this.emitState(internal);
    return cloneState(internal.state);
  }

  destroy(browserId: BrowserSessionId): { ok: boolean } {
    const session = this.sessions.get(browserId);
    if (!session) return { ok: false };
    this.detachActiveView(session);
    for (const tab of session.tabs.values()) {
      tab.dispose();
    }
    session.tabs.clear();
    this.sessions.delete(browserId);
    closeBrowserWindow(browserId);
    return { ok: true };
  }

  setSurface(
    browserId: BrowserSessionId,
    surfaceKind: BrowserSurfaceKind,
    bounds?: BrowserRect
  ): BrowserSessionState {
    const session = this.require(browserId);
    if (session.state.surface.kind === surfaceKind) {
      if (surfaceKind === "window") {
        const win = this.ensureStandaloneWindow(browserId, session.state.projectPath);
        if (!win.isDestroyed()) {
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
        }
      } else {
        const main = this.deps.getMainWindow();
        if (main && !main.isDestroyed()) {
          if (main.isMinimized()) main.restore();
          main.show();
          main.focus();
        }
      }
      return cloneState(session.state);
    }

    this.detachActiveView(session);

    if (surfaceKind === "window") {
      const win = this.ensureStandaloneWindow(browserId, session.state.projectPath);
      const rect = bounds || contentBoundsForWindow(win);
      this.attachActiveView(session, win, rect);
      session.state.surface = { kind: "window", windowId: win.id };
      session.workbenchVisible = false;
    } else {
      closeBrowserWindow(browserId);
      const main = this.deps.getMainWindow();
      if (!main || main.isDestroyed()) {
        throw new Error("Main window is not available.");
      }
      const rect = bounds || session.workbenchBounds;
      session.state.surface = { kind: "workbench", windowId: main.id };
      session.workbenchVisible = true;
      if (rect && rect.width > 0 && rect.height > 0) {
        this.attachActiveView(session, main, rect);
      }
      if (main.isMinimized()) main.restore();
      main.show();
      main.focus();
    }

    this.lastUsedSurface = surfaceKind;
    this.emitState(session);
    this.deps.broadcast({
      type: "surface",
      browserId,
      surface: { ...session.state.surface }
    });
    return cloneState(session.state);
  }

  attachBounds(browserId: BrowserSessionId, rect: BrowserRect, windowId: number): { ok: boolean } {
    const session = this.sessions.get(browserId);
    if (!session) return { ok: false };
    if (session.state.surface.windowId !== windowId) return { ok: false };

    if (session.state.surface.kind === "workbench") {
      session.workbenchBounds = rect;
      if (!session.workbenchVisible) {
        this.detachActiveView(session);
        return { ok: true };
      }
    }

    const win = BrowserWindow.fromId(windowId);
    if (!win || win.isDestroyed()) return { ok: false };
    this.attachActiveView(session, win, rect);
    return { ok: true };
  }

  setVisible(browserId: BrowserSessionId, visible: boolean): { ok: boolean } {
    const session = this.sessions.get(browserId);
    if (!session) return { ok: false };
    if (session.state.surface.kind !== "workbench") {
      return { ok: true };
    }
    session.workbenchVisible = visible;
    if (!visible) {
      this.detachActiveView(session);
      return { ok: true };
    }
    const main = this.deps.getMainWindow();
    const rect = session.workbenchBounds;
    if (main && !main.isDestroyed() && rect && rect.width > 0 && rect.height > 0) {
      this.attachActiveView(session, main, rect);
    }
    return { ok: true };
  }

  focus(browserId: BrowserSessionId): { ok: boolean } {
    const session = this.sessions.get(browserId);
    if (!session) return { ok: false };
    const win = BrowserWindow.fromId(session.state.surface.windowId);
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
    const tab = session.tabs.get(session.state.activeTabId);
    if (tab && !tab.view.webContents.isDestroyed()) {
      tab.view.webContents.focus();
    }
    return { ok: true };
  }

  navigate(browserId: BrowserSessionId, url: string, tabId?: BrowserTabId): BrowserSessionState {
    const session = this.require(browserId);
    const tab = this.activeTab(session, tabId);
    tab.navigate(url);
    return cloneState(session.state);
  }

  back(browserId: BrowserSessionId, tabId?: BrowserTabId): BrowserSessionState {
    const session = this.require(browserId);
    this.activeTab(session, tabId).back();
    return cloneState(session.state);
  }

  forward(browserId: BrowserSessionId, tabId?: BrowserTabId): BrowserSessionState {
    const session = this.require(browserId);
    this.activeTab(session, tabId).forward();
    return cloneState(session.state);
  }

  reload(browserId: BrowserSessionId, tabId?: BrowserTabId): BrowserSessionState {
    const session = this.require(browserId);
    this.activeTab(session, tabId).reload();
    return cloneState(session.state);
  }

  stop(browserId: BrowserSessionId, tabId?: BrowserTabId): BrowserSessionState {
    const session = this.require(browserId);
    this.activeTab(session, tabId).stop();
    return cloneState(session.state);
  }

  newTab(browserId: BrowserSessionId, url?: string): BrowserSessionState {
    const session = this.require(browserId);
    if (session.state.tabs.length >= session.state.policy.maxTabs) {
      throw new Error(`Tab limit reached (${session.state.policy.maxTabs}).`);
    }
    const tabId = randomUUID();
    const tabState: BrowserTabState = {
      tabId,
      url: url?.trim() || "about:blank",
      title: "New Tab",
      loading: false,
      canGoBack: false,
      canGoForward: false
    };
    session.state.tabs.push(tabState);
    const view = this.spawnTab(session, tabId, url);
    session.tabs.set(tabId, view);
    this.activateTabInternal(session, tabId);
    this.emitState(session);
    return cloneState(session.state);
  }

  closeTab(browserId: BrowserSessionId, tabId: BrowserTabId): BrowserSessionState {
    const session = this.require(browserId);
    if (session.state.tabs.length <= 1) {
      this.destroy(browserId);
      throw new Error("SESSION_DESTROYED");
    }
    const tab = session.tabs.get(tabId);
    if (!tab) throw new Error(`Unknown tab: ${tabId}`);
    if (session.state.activeTabId === tabId) {
      this.detachActiveView(session);
    }
    tab.dispose();
    session.tabs.delete(tabId);
    session.state.tabs = session.state.tabs.filter((item) => item.tabId !== tabId);
    if (session.state.activeTabId === tabId) {
      const next = session.state.tabs[session.state.tabs.length - 1];
      this.activateTabInternal(session, next.tabId);
    }
    this.emitState(session);
    return cloneState(session.state);
  }

  activateTab(browserId: BrowserSessionId, tabId: BrowserTabId): BrowserSessionState {
    const session = this.require(browserId);
    this.activateTabInternal(session, tabId);
    this.emitState(session);
    return cloneState(session.state);
  }

  setPolicy(browserId: BrowserSessionId, policy: Partial<BrowserPolicy>): BrowserSessionState {
    const session = this.require(browserId);
    session.state.policy = {
      ...session.state.policy,
      ...policy,
      allowHosts: policy.allowHosts ? [...policy.allowHosts] : session.state.policy.allowHosts,
      blockHosts: policy.blockHosts ? [...policy.blockHosts] : session.state.policy.blockHosts
    };
    this.emitState(session);
    return cloneState(session.state);
  }

  async clearCookies(browserId: BrowserSessionId, hosts?: string[]): Promise<BrowserSessionState> {
    const session = this.require(browserId);
    const { session: electronSession } = await import("electron");
    const ses = electronSession.fromPartition(session.state.partition);
    if (!hosts || hosts.length === 0) {
      await ses.clearStorageData();
    } else {
      const cookies = await ses.cookies.get({});
      for (const cookie of cookies) {
        const domain = (cookie.domain || "").replace(/^\./, "").toLowerCase();
        if (!hosts.some((host) => domain === host.toLowerCase() || domain.endsWith(`.${host.toLowerCase()}`))) {
          continue;
        }
        const url = `${cookie.secure ? "https" : "http"}://${domain}${cookie.path || "/"}`;
        await ses.cookies.remove(url, cookie.name);
      }
    }
    this.emitState(session);
    return cloneState(session.state);
  }

  bindOwner(browserId: BrowserSessionId, owner: BrowserOwner): BrowserSessionState {
    const session = this.require(browserId);
    const exists = session.state.owners.some((item) => {
      if (item.kind !== owner.kind) return false;
      if (item.kind === "acp" && owner.kind === "acp") return item.recordId === owner.recordId;
      if (item.kind === "mcp-client" && owner.kind === "mcp-client") return item.clientName === owner.clientName;
      return false;
    });
    if (!exists) {
      session.state.owners = [...session.state.owners, owner];
      this.emitState(session);
    }
    return cloneState(session.state);
  }

  getTabWebContents(browserId: BrowserSessionId, tabId?: BrowserTabId): import("electron").WebContents | null {
    const session = this.sessions.get(browserId);
    if (!session) return null;
    const id = tabId || session.state.activeTabId;
    const tab = session.tabs.get(id);
    if (!tab || tab.view.webContents.isDestroyed()) return null;
    return tab.view.webContents;
  }

  /** Called when a standalone browser window is closed by the user. */
  onStandaloneWindowClosed(browserId: BrowserSessionId): void {
    const session = this.sessions.get(browserId);
    if (!session) return;
    if (session.state.surface.kind !== "window") return;
    const hasAcpOwner = session.state.owners.some((o) => o.kind === "acp");
    if (hasAcpOwner) {
      try {
        this.setSurface(browserId, "workbench");
      } catch {
        this.destroy(browserId);
      }
    } else {
      this.destroy(browserId);
    }
  }

  disposeAll(): void {
    for (const id of [...this.sessions.keys()]) {
      this.destroy(id);
    }
  }

  private resolveInitialSurface(requested?: BrowserSurfaceKind): BrowserSurfaceKind {
    if (requested === "workbench" || requested === "window") return requested;
    const pref = this.deps.getDefaultSurface?.() || "workbench";
    if (pref === "last-used") return this.lastUsedSurface;
    return pref === "window" ? "window" : "workbench";
  }

  private resolveHostWindow(kind: BrowserSurfaceKind, preferredWindowId?: number): BrowserWindow | null {
    if (preferredWindowId != null) {
      const preferred = BrowserWindow.fromId(preferredWindowId);
      if (preferred && !preferred.isDestroyed()) return preferred;
    }
    if (kind === "workbench") return this.deps.getMainWindow();
    return this.deps.getMainWindow();
  }

  private ensureStandaloneWindow(browserId: BrowserSessionId, projectPath: string): BrowserWindow {
    return getOrCreateBrowserWindow({
      browserId,
      preloadPath: this.deps.getPreloadPath(),
      icon: this.deps.getIcon?.(),
      title: `Browser · ${projectPath.split(/[\\/]/).filter(Boolean).pop() || "Agent"}`,
      onClosed: (id) => this.onStandaloneWindowClosed(id)
    });
  }

  private spawnTab(session: InternalSession, tabId: BrowserTabId, startUrl?: string): ElectronTabView {
    return createElectronTabView({
      tabId,
      partition: session.state.partition,
      startUrl,
      hooks: {
        getPolicy: () => session.state.policy,
        onTabState: (id, patch) => {
          const tab = session.state.tabs.find((item) => item.tabId === id);
          if (!tab) return;
          Object.assign(tab, patch);
          this.emitState(session);
        },
        onConsole: (id, level, message) => {
          this.deps.broadcast({
            type: "console",
            browserId: session.state.id,
            tabId: id,
            level,
            message
          });
        }
      }
    });
  }

  private activateTabInternal(session: InternalSession, tabId: BrowserTabId): void {
    if (!session.tabs.has(tabId)) throw new Error(`Unknown tab: ${tabId}`);
    if (session.state.activeTabId === tabId) return;
    this.detachActiveView(session);
    session.state.activeTabId = tabId;
    const win = BrowserWindow.fromId(session.state.surface.windowId);
    if (!win || win.isDestroyed()) return;
    if (session.state.surface.kind === "workbench" && !session.workbenchVisible) return;
    const rect =
      session.state.surface.kind === "window"
        ? contentBoundsForWindow(win)
        : session.workbenchBounds;
    if (rect && rect.width > 0 && rect.height > 0) {
      this.attachActiveView(session, win, rect);
    }
  }

  private activeTab(session: InternalSession, tabId?: BrowserTabId): ElectronTabView {
    const id = tabId || session.state.activeTabId;
    const tab = session.tabs.get(id);
    if (!tab) throw new Error(`Unknown tab: ${id}`);
    return tab;
  }

  private attachActiveView(session: InternalSession, win: BrowserWindow, rect: BrowserRect): void {
    const tab = session.tabs.get(session.state.activeTabId);
    if (!tab || tab.view.webContents.isDestroyed()) return;
    const view = tab.view as WebContentsView;
    try {
      this.removeViewFromAllWindows(view);
      win.contentView.addChildView(view);
      view.setBounds({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height))
      });
    } catch {
      // ignore attach races during window teardown
    }
  }

  private detachActiveView(session: InternalSession): void {
    const tab = session.tabs.get(session.state.activeTabId);
    if (!tab) return;
    this.removeViewFromAllWindows(tab.view);
  }

  private removeViewFromAllWindows(view: WebContentsView): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      try {
        win.contentView.removeChildView(view);
      } catch {
        // not a child
      }
    }
  }

  private require(browserId: BrowserSessionId): InternalSession {
    const session = this.sessions.get(browserId);
    if (!session) throw new Error(`Unknown browser session: ${browserId}`);
    return session;
  }

  private emitState(session: InternalSession): void {
    this.deps.broadcast({ type: "state", session: cloneState(session.state) });
  }
}
