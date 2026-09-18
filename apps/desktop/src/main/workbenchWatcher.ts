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

/**
 * One watch per project root, shared by every window that shows it.
 *
 * Several workbench windows commonly show the same repository, and a recursive
 * watcher plus a rescan timer per window would multiply both the descriptors and
 * the CPU for identical information. The watch itself is therefore shared; each
 * window only subscribes to the roots it currently displays.
 */
type SharedWatch = {
  rootPath: string;
  recursiveWatcher: fs.FSWatcher | null;
  batchTimer: NodeJS.Timeout | null;
  pollTimer: NodeJS.Timeout | null;
  pollIndex: number;
  pendingPaths: Set<string>;
  fullRescan: boolean;
  sequence: number;
  /** Windows watching this root, so a gone window can be forgotten. */
  subscribers: Map<number, WebContents>;
  /** Subscribers that are currently showing their workbench. */
  activeSenders: Set<number>;
  stopped: boolean;
};

/** Project root → shared watch. */
const watches = new Map<string, SharedWatch>();

type WorkbenchWatcherRuntimeMetrics = {
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

/** Deliver an event to every subscriber that is currently showing its workbench. */
function emit(watch: SharedWatch, event: WorkbenchFileSystemChangedEvent): void {
  if (watch.stopped) return;
  for (const [senderId, sender] of watch.subscribers) {
    if (!watch.activeSenders.has(senderId)) continue;
    if (sender.isDestroyed()) continue;
    try { sender.send("workbench:fileSystemChanged", event); } catch { /* renderer may be closing */ }
  }
}

function queueChange(watch: SharedWatch, changedPath: string | null): void {
  if (watch.stopped) return;
  if (!hasActiveSubscriber(watch)) return;
  if (!changedPath) {
    watch.fullRescan = true;
  } else {
    const resolved = path.resolve(changedPath);
    if (!isWithinRoot(resolved, watch.rootPath)) {
      watch.fullRescan = true;
    } else if (watch.pendingPaths.size < MAX_PENDING_PATHS) {
      watch.pendingPaths.add(resolved);
    } else {
      watch.fullRescan = true;
    }
  }
  if (watch.batchTimer) return;
  watch.batchTimer = setTimeout(() => {
    watch.batchTimer = null;
    if (watch.stopped) return;
    const paths = [...watch.pendingPaths];
    watch.pendingPaths.clear();
    const fullRescan = watch.fullRescan;
    watch.fullRescan = false;
    emit(watch, {
      type: "change",
      rootPath: watch.rootPath,
      paths,
      fullRescan,
      sequence: ++watch.sequence
    });
  }, CHANGE_BATCH_MS);
}

function hasActiveSubscriber(watch: SharedWatch): boolean {
  for (const senderId of watch.activeSenders) {
    if (watch.subscribers.has(senderId)) return true;
  }
  return false;
}

function installPolling(watch: SharedWatch): void {
  if (watch.stopped || watch.pollTimer) return;
  if (!hasActiveSubscriber(watch)) return;
  const delay = WORKBENCH_POLL_INTERVALS_MS[watch.pollIndex]
    || WORKBENCH_POLL_INTERVALS_MS[WORKBENCH_POLL_INTERVALS_MS.length - 1]!;
  watch.pollTimer = setTimeout(() => {
    watch.pollTimer = null;
    if (watch.stopped || !hasActiveSubscriber(watch)) return;
    queueChange(watch, null);
    watch.pollIndex = Math.min(watch.pollIndex + 1, WORKBENCH_POLL_INTERVALS_MS.length - 1);
    installPolling(watch);
  }, delay);
  watch.pollTimer.unref?.();
  queueChange(watch, null);
}

function stopPolling(watch: SharedWatch): void {
  if (watch.pollTimer) clearTimeout(watch.pollTimer);
  watch.pollTimer = null;
  if (watch.batchTimer) clearTimeout(watch.batchTimer);
  watch.batchTimer = null;
  watch.pendingPaths.clear();
  watch.fullRescan = false;
}

function fallBackToPolling(watch: SharedWatch, error: unknown): void {
  if (watch.stopped || watch.pollTimer) return;
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[workbench] Recursive file watching unavailable; using adaptive polling: ${message}`);
  if (watch.recursiveWatcher) closeWatcher(watch.recursiveWatcher);
  watch.recursiveWatcher = null;
  installPolling(watch);
}

function installWatchers(watch: SharedWatch): void {
  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(watch.rootPath, { recursive: true, persistent: false }, (_eventType, filename) => {
      queueChange(watch, filename ? path.join(watch.rootPath, filename.toString()) : null);
    });
  } catch (error) {
    fallBackToPolling(watch, error);
    return;
  }
  watcher.on("error", (error) => fallBackToPolling(watch, error));
  watch.recursiveWatcher = watcher;
}

/**
 * Mark one window's workbench as visible or hidden.
 *
 * Hiding the last visible subscriber stops the poll timer; showing one again
 * restarts the fast interval and asks for a full rescan, since changes that
 * happened while it was hidden were deliberately not delivered.
 */
export function setWorkbenchWatcherActive(senderId: number, active: boolean): void {
  for (const watch of watches.values()) {
    if (!watch.subscribers.has(senderId)) continue;
    const wasActive = watch.activeSenders.has(senderId);
    if (active) watch.activeSenders.add(senderId);
    else watch.activeSenders.delete(senderId);

    if (!hasActiveSubscriber(watch)) {
      stopPolling(watch);
      continue;
    }
    watch.pollIndex = 0;
    if (!watch.recursiveWatcher) installPolling(watch);
    if (active && !wasActive) queueChange(watch, null);
  }
}

export function getWorkbenchWatcherRuntimeMetrics(): WorkbenchWatcherRuntimeMetrics {
  let watcherCount = 0;
  let pollingCount = 0;
  let activeCount = 0;
  for (const watch of watches.values()) {
    watcherCount += 1;
    if (watch.pollTimer) pollingCount += 1;
    if (hasActiveSubscriber(watch)) activeCount += 1;
  }
  return { watcherCount, pollingCount, activeCount };
}

function dropWatch(watch: SharedWatch): void {
  if (watch.stopped) return;
  watch.stopped = true;
  stopPolling(watch);
  if (watch.recursiveWatcher) closeWatcher(watch.recursiveWatcher);
  watch.recursiveWatcher = null;
  watch.subscribers.clear();
  watch.activeSenders.clear();
}

/** Forget every subscription of one window, closing roots nobody watches. */
function stopSender(senderId: number): void {
  for (const [rootPath, watch] of watches) {
    if (!watch.subscribers.delete(senderId)) continue;
    watch.activeSenders.delete(senderId);
    if (watch.subscribers.size === 0) {
      dropWatch(watch);
      watches.delete(rootPath);
      continue;
    }
    if (!hasActiveSubscriber(watch)) stopPolling(watch);
  }
}

export function disposeWorkbenchWatchers(): void {
  for (const [rootPath, watch] of watches) {
    dropWatch(watch);
    watches.delete(rootPath);
  }
}

export function registerWorkbenchWatcherIpc(
  getMainWindow: () => BrowserWindow | null,
  isAppWindowSender: (sender: WebContents) => boolean = () => false
): void {
  safeHandle(
    "workbench:setFileWatch",
    async (event, args: { rootPaths: string[] | null }) => {
      // Every workbench window watches its own roots; the main window is listed
      // explicitly so a foreign webContents (browser pane) can never subscribe.
      if (event.sender !== getMainWindow()?.webContents && !isAppWindowSender(event.sender)) {
        throw new Error("无效的窗口来源");
      }
      const senderId = event.sender.id;
      stopSender(senderId);
      const requested = args?.rootPaths;
      if (!requested || !requested.length) return { rootPaths: [] as string[] };
      // A project referenced by a synced task may not exist here; skip those
      // rather than failing the whole watch set.
      const rootPaths: string[] = [];
      const seen = new Set<string>();
      for (const raw of requested) {
        try {
          const rootPath = resolveWatchRoot(raw);
          if (seen.has(rootPath)) continue;
          seen.add(rootPath);
          rootPaths.push(rootPath);
        } catch {
          // Skip unwatchable roots.
        }
      }
      event.sender.once("destroyed", () => stopSender(senderId));
      for (const rootPath of rootPaths) {
        let watch = watches.get(rootPath);
        if (!watch) {
          watch = {
            rootPath,
            recursiveWatcher: null,
            batchTimer: null,
            pollTimer: null,
            pollIndex: 0,
            pendingPaths: new Set(),
            fullRescan: false,
            sequence: 0,
            subscribers: new Map(),
            activeSenders: new Set(),
            stopped: false
          };
          watches.set(rootPath, watch);
          installWatchers(watch);
        }
        watch.subscribers.set(senderId, event.sender);
        watch.activeSenders.add(senderId);
        watch.pollIndex = 0;
        if (!watch.recursiveWatcher && !watch.pollTimer) installPolling(watch);
      }
      return { rootPaths };
    }
  );
}
