import { desktopApi } from "./bridge";

export interface ConfirmOptions {
  /** Secondary line under the question, for the consequence the user must read. */
  detail?: string;
  /** Verb for the action button ("Delete", "Discard", …). Defaults to Confirm. */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Renders an alert instead of a question and keeps Return on Cancel. */
  destructive?: boolean;
}

/**
 * Ask the user to confirm an action.
 *
 * Uses the native alert (`NSAlert`): it carries the app icon, follows the system
 * appearance and language, is keyboard-drivable, and — unlike `window.confirm` —
 * is not a Chromium dialog titled with the page origin. When the bridge is
 * unavailable (tests, an older preload) it degrades to `window.confirm`, which
 * is why call sites never need to know which one they got.
 */
export async function confirmAction(message: string, options?: ConfirmOptions): Promise<boolean> {
  const api = desktopApi();
  if (typeof api?.dialogConfirm !== "function") return window.confirm(message);
  try {
    return await api.dialogConfirm({ message, ...options });
  } catch {
    return false;
  }
}

/** Confirm a destructive action with a verb button. */
export function confirmDestructive(message: string, confirmLabel: string, detail?: string): Promise<boolean> {
  return confirmAction(message, { confirmLabel, detail, destructive: true });
}
