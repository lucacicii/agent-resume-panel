/**
 * Notifications for panes that started waiting for a human, posted while no
 * window is attached.
 *
 * This is the payoff of the daemon outliving the app: an agent that blocks at
 * 02:00 while every window is closed still reaches the user. It is deliberately
 * narrow — only a transition *into* blocked, only when no window is connected —
 * because a notification that fires while the panel is open in front of you is
 * noise.
 *
 * Uses `osascript` so the daemon needs no notification library and no helper app.
 */

import { execFile } from "node:child_process";

export type BlockedNotification = {
  paneId: number;
  agent: string;
  /** Optional session title, when the pane reported one. */
  title?: string;
};

export type BlockedNotifier = {
  notify: (items: readonly BlockedNotification[]) => void;
};

export function createBlockedNotifier(input: {
  enabled: boolean;
  platform?: string;
  log?: (message: string) => void;
  /** Injection point for tests. */
  run?: (script: string) => void;
}): BlockedNotifier {
  const log = input.log ?? (() => undefined);
  const platform = input.platform ?? process.platform;
  const run = input.run ?? ((script: string) => {
    execFile("osascript", ["-e", script], { timeout: 5_000 }, () => undefined);
  });

  return {
    notify(items) {
      if (!input.enabled || platform !== "darwin" || !items.length) return;
      for (const item of items) {
        const subject = item.title?.trim() || `pane ${item.paneId}`;
        const message = `${item.agent} needs you — ${subject}`;
        run(`display notification ${quote(message)} with title ${quote("Agent Resume")}`);
        log(`notified: ${message}`);
      }
    }
  };
}

/** AppleScript string literal: escape backslashes and double quotes. */
function quote(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
