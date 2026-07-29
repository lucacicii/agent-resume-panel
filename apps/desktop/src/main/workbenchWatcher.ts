import { BrowserWindow, type WebContents } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { expandHome } from "@agent-resume/core";
import { safeHandle } from "./ipcUtils";

const CHANGE_BATCH_MS = 120;
const MAX_PENDING_PATHS = 512;

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
  directoryWatchers: Map<string, fs.FSWatcher>;
  batchTimer: NodeJS.Timeout | null;
  rebuildTimer: NodeJS.Timeout | null;
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

function listDirectories(rootPath: string): string[] {
  const result: string[] = [];
  const pending = [rootPath];
  while (pending.length) {
    const current = pending.pop()!;
    result.push(current);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      pending.push(path.join(current, entry.name));
    }
  }
  return result;
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

function scheduleFallbackRebuild(state: WatchState): void {
  if (state.rebuildTimer || state.stopped) return;
  state.rebuildTimer = setTimeout(() => {
    state.rebuildTimer = null;
    if (state.stopped) return;
    for (const watcher of state.directoryWatchers.values()) closeWatcher(watcher);
    state.directoryWatchers.clear();
    installFallbackWatchers(state);
  }, CHANGE_BATCH_MS);
}

function installFallbackWatchers(state: WatchState): void {
  for (const directory of listDirectories(state.rootPath)) {
    if (state.stopped || state.directoryWatchers.has(directory)) continue;
    try {
      const watcher = fs.watch(directory, { persistent: false }, (_eventType, filename) => {
        const changed = filename ? path.join(directory, filename.toString()) : null;
        queueChange(state, changed);
        scheduleFallbackRebuild(state);
      });
      watcher.on("error", (error) => {
        emit(state, {
          type: "error",
          rootPath: state.rootPath,
          message: error instanceof Error ? error.message : String(error),
          sequence: ++state.sequence
        });
      });
      state.directoryWatchers.set(directory, watcher);
    } catch (error) {
      emit(state, {
        type: "error",
        rootPath: state.rootPath,
        message: error instanceof Error ? error.message : String(error),
        sequence: ++state.sequence
      });
    }
  }
}

function installWatchers(state: WatchState): void {
  try {
    const watcher = fs.watch(state.rootPath, { recursive: true, persistent: false }, (_eventType, filename) => {
      queueChange(state, filename ? path.join(state.rootPath, filename.toString()) : null);
    });
    watcher.on("error", (error) => {
      emit(state, {
        type: "error",
        rootPath: state.rootPath,
        message: error instanceof Error ? error.message : String(error),
        sequence: ++state.sequence
      });
    });
    state.recursiveWatcher = watcher;
  } catch {
    installFallbackWatchers(state);
  }
}

function stopWatch(state: WatchState): void {
  if (state.stopped) return;
  state.stopped = true;
  if (state.batchTimer) clearTimeout(state.batchTimer);
  if (state.rebuildTimer) clearTimeout(state.rebuildTimer);
  if (state.recursiveWatcher) closeWatcher(state.recursiveWatcher);
  for (const watcher of state.directoryWatchers.values()) closeWatcher(watcher);
  state.directoryWatchers.clear();
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
        directoryWatchers: new Map(),
        batchTimer: null,
        rebuildTimer: null,
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
