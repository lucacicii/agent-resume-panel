import { BrowserWindow, type WebContents } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { expandHome } from "@agent-resume/core";
import { safeHandle } from "./ipcUtils";

const CHANGE_BATCH_MS = 120;
const MAX_PENDING_PATHS = 512;
export const WORKBENCH_POLL_INTERVALS_MS = [2_000, 5_000, 15_000] as const;

export type WorkbenchFileSystemChangedEvent =
  | {
      type: "change";
      rootPath: string;
      paths: string[];
      fullRescan: boolean;
      sequence: number;
    }
  | {
      type: "error";
      rootPath: string;
      message: string;
      sequence: number;
    };

type WatchState = {
  sender: WebContents;
  rootPath: string;
  recursiveWatcher: fs.FSWatcher | null;
  batchTimer: NodeJS.Timeout | null;
  pollTimer: NodeJS.Timeout | null;
  pollIndex: number;
  active: boolean;
  pendingPaths: Set<string>;
  fullRescan: boolean;
  sequence: number;
  stopped: boolean;
};

const watches = new Map<number, WatchState>();

export type WorkbenchWatcherRuntimeMetrics = {
  watcherCount: number;
  pollingCount: number;
  activeCount: number;
};

function isWithinRoot(target: string, root: string): boolean {
  return target === root || target.startsWith(root + path.sep);
}

function resolveWatchRoot(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) throw new Error("无效的项目路径");
  const requested = path.resolve(expandHome(raw.trim()));
  const stat = fs.statSync(requested);
  if (!stat.isDirectory()) throw new Error("项目路径不是文件夹");
  fs.realpathSync.native(requested);
  return requested;
}

function closeWatcher(watcher: fs.FSWatcher): void {
  try { watcher.close(); } catch { /* watcher may already be closed */ }
}

function emit(state: WatchState, event: WorkbenchFileSystemChangedEvent): void {
  if (state.stopped || state.sender.isDestroyed()) return;
  try { state.sender.send("workbench:fileSystemChanged", event); } catch { /* renderer may be closing */ }
}

function queueChange(state: WatchState, changedPath: string | null): void {
  if (state.stopped || !state.active) return;
  if (!changedPath) {
    state.fullRescan = true;
  } else {
    const resolved = path.resolve(changedPath);
    if (!isWithinRoot(resolved, state.rootPath)) {
      state.fullRescan = true;
    } else if (state.pendingPaths.size < MAX_PENDING_PATHS) {
      state.pendingPaths.add(resolved);
    } else {
      state.fullRescan = true;
    }
  }
  if (state.batchTimer) return;
  state.batchTimer = setTimeout(() => {
    state.batchTimer = null;
    if (state.stopped) return;
    const paths = [...state.pendingPaths];
    state.pendingPaths.clear();
    const fullRescan = state.fullRescan;
    state.fullRescan = false;
    emit(state, {
      type: "change",
      rootPath: state.rootPath,
      paths,
      fullRescan,
      sequence: ++state.sequence
    });
  }, CHANGE_BATCH_MS);
}

function installPolling(state: WatchState): void {
  if (state.stopped || state.pollTimer) return;
  if (!state.active) return;
  const delay = WORKBENCH_POLL_INTERVALS_MS[state.pollIndex]
    || WORKBENCH_POLL_INTERVALS_MS[WORKBENCH_POLL_INTERVALS_MS.length - 1]!;
  state.pollTimer = setTimeout(() => {
    state.pollTimer = null;
    if (state.stopped || !state.active) return;
    queueChange(state, null);
    state.pollIndex = Math.min(state.pollIndex + 1, WORKBENCH_POLL_INTERVALS_MS.length - 1);
    installPolling(state);
  }, delay);
  state.pollTimer.unref?.();
  queueChange(state, null);
}

function fallBackToPolling(state: WatchState, error: unknown): void {
  if (state.stopped || state.pollTimer) return;
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[workbench] Recursive file watching unavailable; using adaptive polling: ${message}`);
  if (state.recursiveWatcher) closeWatcher(state.recursiveWatcher);
  state.recursiveWatcher = null;
  installPolling(state);
}

export function setWorkbenchWatcherActive(active: boolean): void {
  for (const state of watches.values()) {
    const wasActive = state.active;
    state.active = active;
    if (!active) {
      if (state.pollTimer) clearTimeout(state.pollTimer);
      state.pollTimer = null;
      if (state.batchTimer) clearTimeout(state.batchTimer);
      state.batchTimer = null;
      state.pendingPaths.clear();
      state.fullRescan = false;
      continue;
    }
    state.pollIndex = 0;
    if (!state.recursiveWatcher) installPolling(state);
    if (!wasActive) queueChange(state, null);
  }
}

export function getWorkbenchWatcherRuntimeMetrics(): WorkbenchWatcherRuntimeMetrics {
  let pollingCount = 0;
  let activeCount = 0;
  for (const state of watches.values()) {
    if (state.pollTimer) pollingCount += 1;
    if (state.active) activeCount += 1;
  }
  return { watcherCount: watches.size, pollingCount, activeCount };
}

function installWatchers(state: WatchState): void {
  try {
    const watcher = fs.watch(state.rootPath, { recursive: true, persistent: false }, (_eventType, filename) => {
      queueChange(state, filename ? path.join(state.rootPath, filename.toString()) : null);
    });
    watcher.on("error", (error) => fallBackToPolling(state, error));
    state.recursiveWatcher = watcher;
  } catch (error) {
    fallBackToPolling(state, error);
  }
}

function stopWatch(state: WatchState): void {
  if (state.stopped) return;
  state.stopped = true;
  if (state.batchTimer) clearTimeout(state.batchTimer);
  if (state.pollTimer) clearTimeout(state.pollTimer);
  if (state.recursiveWatcher) closeWatcher(state.recursiveWatcher);
  state.pendingPaths.clear();
}

function stopSender(senderId: number): void {
  const state = watches.get(senderId);
  if (!state) return;
  watches.delete(senderId);
  stopWatch(state);
}

export function disposeWorkbenchWatchers(): void {
  for (const senderId of [...watches.keys()]) stopSender(senderId);
}

export function registerWorkbenchWatcherIpc(getMainWindow: () => BrowserWindow | null): void {
  safeHandle(
    "workbench:setFileWatch",
    async (event, args: { rootPath: string | null }) => {
      if (event.sender !== getMainWindow()?.webContents) throw new Error("无效的窗口来源");
      stopSender(event.sender.id);
      if (args?.rootPath == null) return { rootPath: null };
      const rootPath = resolveWatchRoot(args.rootPath);
      const state: WatchState = {
        sender: event.sender,
        rootPath,
        recursiveWatcher: null,
        batchTimer: null,
        pollTimer: null,
        pollIndex: 0,
        active: true,
        pendingPaths: new Set(),
        fullRescan: false,
        sequence: 0,
        stopped: false
      };
      watches.set(event.sender.id, state);
      event.sender.once("destroyed", () => stopSender(event.sender.id));
      installWatchers(state);
      return { rootPath };
    }
  );
}
