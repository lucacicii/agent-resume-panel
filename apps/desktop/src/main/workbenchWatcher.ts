import { BrowserWindow, type WebContents } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { expandHome } from "@agent-resume/core";
import { safeHandle } from "./ipcUtils";

const CHANGE_BATCH_MS = 120;
const MAX_PENDING_PATHS = 512;
const POLL_INTERVAL_MS = 2_000;

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
  pendingPaths: Set<string>;
  fullRescan: boolean;
  sequence: number;
  stopped: boolean;
};

const watches = new Map<number, WatchState>();

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
  if (state.stopped) return;
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
  state.pollTimer = setInterval(() => queueChange(state, null), POLL_INTERVAL_MS);
  state.pollTimer.unref?.();
  queueChange(state, null);
}

function fallBackToPolling(state: WatchState, error: unknown): void {
  if (state.stopped || state.pollTimer) return;
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[workbench] Recursive file watching unavailable; using ${POLL_INTERVAL_MS}ms polling: ${message}`);
  if (state.recursiveWatcher) closeWatcher(state.recursiveWatcher);
  state.recursiveWatcher = null;
  installPolling(state);
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
  if (state.pollTimer) clearInterval(state.pollTimer);
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
