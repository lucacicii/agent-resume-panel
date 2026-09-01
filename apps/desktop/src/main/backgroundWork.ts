import { BrowserWindow, powerMonitor } from "electron";

const MIN_SYSTEM_IDLE_SECONDS = 30;
let queue: Promise<void> = Promise.resolve();

export function shouldRunDesktopBackgroundWork(): boolean {
  const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
  if (window?.isMinimized()) return false;
  if (!window?.isFocused()) return true;
  try {
    return powerMonitor.getSystemIdleTime() >= MIN_SYSTEM_IDLE_SECONDS;
  } catch {
    return false;
  }
}

/** Serialize expensive indexing and LLM-backed maintenance jobs. */
export function enqueueDesktopBackgroundWork(task: () => Promise<void>): Promise<void> {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

export function resetDesktopBackgroundQueueForTests(): void {
  queue = Promise.resolve();
}
