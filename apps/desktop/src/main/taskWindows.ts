import { BrowserWindow, screen, type NativeImage } from "electron";

/**
 * Task workbench windows.
 *
 * A workbench is the unit that owns panes — terminals, editors, diffs, notes.
 * Keeping one workbench per OS window is what lets the board window stay cheap:
 * the board pays for a board, a workbench window pays for exactly one
 * workbench. The same workbenchId therefore has at most one window; opening it
 * again focuses what is already there instead of mounting a second copy, which
 * would duplicate renderer processes and let two windows fight over the same
 * pty ownership.
 */

const DEFAULT_SIZE = { width: 1180, height: 820 } as const;
const MIN_SIZE = { minWidth: 860, minHeight: 600 } as const;
/** Each window is a renderer process plus its panes; four is the budget. */
export const MAX_TASK_WINDOWS = 4;

export type TaskWindowState = {
  workbenchId: string;
  noteId: string;
  title: string;
  window: BrowserWindow;
  /** Cold-open timings, for "is the window slow?" questions. */
  timings: { created: number; loadedAt?: number; shownAt?: number };
};

export type TaskWindowSummary = {
  workbenchId: string;
  noteId: string;
  title: string;
};

export type TaskWindowDeps = {
  preloadPath: string;
  rendererIndex: string;
  icon?: NativeImage;
  /** Called once per window so the host can install its keyboard shortcuts. */
  onCreated: (win: BrowserWindow) => void;
  /** Called whenever the open-window set changes (create, close, rename). */
  onChange: (windows: TaskWindowSummary[]) => void;
};

export type OpenTaskWindowArgs = {
  noteId: string;
  workbenchId: string;
  title?: string;
  /** Screen point to center the new window on (used by drag-out). */
  x?: number;
  y?: number;
};

export type OpenTaskWindowResult =
  | { ok: true; created: boolean }
  | { ok: false; reason: "limit"; limit: number };

const taskWindows = new Map<string, TaskWindowState>();
const boundsByWorkbenchId = new Map<string, Electron.Rectangle>();
/** Most recently focused window, so session events have an obvious target. */
let recentWorkbenchId: string | null = null;

export function summarizeTaskWindows(): TaskWindowSummary[] {
  const out: TaskWindowSummary[] = [];
  for (const state of listTaskWindows()) {
    out.push({ workbenchId: state.workbenchId, noteId: state.noteId, title: state.title });
  }
  return out;
}

export function listTaskWindows(): TaskWindowState[] {
  const out: TaskWindowState[] = [];
  for (const [workbenchId, state] of taskWindows) {
    if (state.window.isDestroyed()) {
      taskWindows.delete(workbenchId);
      continue;
    }
    out.push(state);
  }
  return out;
}

export function openTaskWindowCount(): number {
  return listTaskWindows().length;
}

/** How long each open window took to load and to show, in milliseconds. */
export function taskWindowOpenTimings(): Array<{
  workbenchId: string;
  loadMs: number | null;
  showMs: number | null;
}> {
  return listTaskWindows().map((state) => ({
    workbenchId: state.workbenchId,
    loadMs: state.timings.loadedAt != null ? state.timings.loadedAt - state.timings.created : null,
    showMs: state.timings.shownAt != null ? state.timings.shownAt - state.timings.created : null
  }));
}

export function getTaskWindow(workbenchId: string): BrowserWindow | null {
  const state = taskWindows.get(workbenchId);
  if (!state || state.window.isDestroyed()) {
    taskWindows.delete(workbenchId);
    return null;
  }
  return state.window;
}

export function taskWindowStateForSender(sender: Electron.WebContents): TaskWindowState | undefined {
  return listTaskWindows().find((state) => state.window.webContents === sender);
}

/** True when `sender` belongs to one of our workbench windows. */
export function isTaskWindowSender(sender: Electron.WebContents): boolean {
  return taskWindowStateForSender(sender) !== undefined;
}

export function focusTaskWindow(workbenchId: string): boolean {
  const win = getTaskWindow(workbenchId);
  if (!win) return false;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return true;
}

/**
 * The window a session-scoped event should land in: the focused workbench
 * window, else the most recently focused one.
 */
export function focusedOrRecentTaskWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && isTaskWindowSender(focused.webContents)) return focused;
  if (recentWorkbenchId) {
    const recent = getTaskWindow(recentWorkbenchId);
    if (recent) return recent;
  }
  const open = listTaskWindows();
  return open.length ? open[open.length - 1]!.window : null;
}

export function openTaskWindow(deps: TaskWindowDeps, args: OpenTaskWindowArgs): OpenTaskWindowResult {
  const existing = getTaskWindow(args.workbenchId);
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return { ok: true, created: false };
  }
  if (listTaskWindows().length >= MAX_TASK_WINDOWS) {
    return { ok: false, reason: "limit", limit: MAX_TASK_WINDOWS };
  }

  const title = args.title?.trim() || "Workbench";
  const saved = boundsByWorkbenchId.get(args.workbenchId);
  const win = new BrowserWindow({
    ...(saved || DEFAULT_SIZE),
    ...MIN_SIZE,
    title,
    show: false,
    ...(deps.icon ? { icon: deps.icon } : {}),
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: process.platform === "darwin" ? { x: 14, y: 14 } : undefined,
    webPreferences: {
      preload: deps.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  if (process.platform !== "darwin") win.setMenuBarVisibility(false);
  deps.onCreated(win);

  const state: TaskWindowState = {
    workbenchId: args.workbenchId,
    noteId: args.noteId,
    title,
    window: win,
    timings: { created: Date.now() }
  };
  taskWindows.set(args.workbenchId, state);

  win.webContents.once("did-finish-load", () => {
    state.timings.loadedAt = Date.now();
  });

  const rememberBounds = () => {
    if (!win.isDestroyed()) boundsByWorkbenchId.set(args.workbenchId, win.getBounds());
  };
  win.on("resize", rememberBounds);
  win.on("move", rememberBounds);
  win.on("focus", () => { recentWorkbenchId = args.workbenchId; });
  win.on("closed", () => {
    rememberBounds();
    if (taskWindows.get(args.workbenchId) === state) taskWindows.delete(args.workbenchId);
    if (recentWorkbenchId === args.workbenchId) recentWorkbenchId = null;
    deps.onChange(summarizeTaskWindows());
  });

  positionTaskWindow(win, args);
  win.once("ready-to-show", () => {
    if (win.isDestroyed()) return;
    state.timings.shownAt = Date.now();
    console.log(
      `[task-window] ${args.workbenchId} shown in ${state.timings.shownAt - state.timings.created}ms`
      + (state.timings.loadedAt != null ? ` (loaded ${state.timings.loadedAt - state.timings.created}ms)` : "")
    );
    win.show();
    win.focus();
  });
  void win
    .loadFile(deps.rendererIndex, {
      query: { mode: "task", noteId: args.noteId, workbenchId: args.workbenchId }
    })
    .catch(() => undefined);

  deps.onChange(summarizeTaskWindows());
  return { ok: true, created: true };
}

export function setTaskWindowTitle(workbenchId: string, title: string): void {
  const state = taskWindows.get(workbenchId);
  if (!state || state.window.isDestroyed()) return;
  const next = title.trim();
  if (!next || next === state.title) return;
  state.title = next;
  state.window.setTitle(next);
}

export function closeTaskWindow(workbenchId: string): boolean {
  const win = getTaskWindow(workbenchId);
  if (!win) return false;
  win.close();
  return true;
}

export function closeAllTaskWindows(): void {
  for (const state of listTaskWindows()) {
    if (!state.window.isDestroyed()) state.window.close();
  }
}

/** Center the window on a screen point, clamped to the display work area. */
function positionTaskWindow(win: BrowserWindow, args: OpenTaskWindowArgs): void {
  if (typeof args.x !== "number" || typeof args.y !== "number") return;
  if (!Number.isFinite(args.x) || !Number.isFinite(args.y)) return;
  if (win.isDestroyed()) return;
  const { width, height } = win.getBounds();
  const display = screen.getDisplayNearestPoint({ x: Math.round(args.x), y: Math.round(args.y) });
  const work = display.workArea;
  const x = Math.min(
    Math.max(Math.round(args.x - width / 2), work.x),
    Math.max(work.x, work.x + work.width - width)
  );
  const y = Math.min(
    Math.max(Math.round(args.y - 24), work.y),
    Math.max(work.y, work.y + work.height - height)
  );
  win.setPosition(x, y);
}
