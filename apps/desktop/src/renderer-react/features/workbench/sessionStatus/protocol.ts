/**
 * Tier 0 — explicit status signals carried in the PTY byte stream.
 *
 * These are the only *exact* signals available without native hooks. An agent
 * (or a companion extension acting for it) writes a status escape sequence and
 * we read it verbatim. No heuristics, no screen scraping.
 */

import type { ReportedStatus } from "./types";

/** Custom Agent Resume sequence: `ESC ] 633 ; AR ; <state> [ ; <detail> ] ST`. */
const AR_SEQUENCE = /\x1b\]633;AR;(awaiting|running|idle)(?:;([^\x07\x1b]*))?(?:\x07|\x1b\\)/;
const AR_SEQUENCE_GLOBAL = /\x1b\]633;AR;(?:awaiting|running|idle)(?:;[^\x07\x1b]*)?(?:\x07|\x1b\\)/g;

/** VS Code shell-integration markers. */
const SHELL_PROMPT = /\x1b\]633;A(?:\x07|\x1b\\)/;
const SHELL_COMMAND_START = /\x1b\]633;C(?:\x07|\x1b\\)/;
const SHELL_COMMAND_END = /\x1b\]633;D(?:;(\d+))?(?:\x07|\x1b\\)/;

/** Strip CSI / OSC / common SGR so dialog copy is matchable. */
export function stripAnsi(input: string): string {
  return input
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "")
    .replace(/\r/g, "");
}

/**
 * Parse explicit status sequences out of one PTY chunk.
 *
 * Returns `null` when the chunk carries no status signal, which is the common
 * case — this function must stay allocation-light because it runs on every
 * byte of agent output.
 */
export function parseReportedStatus(chunk: string): ReportedStatus | null {
  if (!chunk || !chunk.includes("\x1b]633;")) return null;

  const agentResume = chunk.match(AR_SEQUENCE);
  if (agentResume) {
    const detail = agentResume[2]?.trim() || undefined;
    switch (agentResume[1]) {
      case "awaiting":
        return { status: "awaiting_user", awaitingConfidence: "confirmed", detail };
      case "running":
        return { status: "running", detail };
      default:
        return { status: "open", detail };
    }
  }

  if (SHELL_COMMAND_START.test(chunk)) return { status: "running" };

  const commandEnd = chunk.match(SHELL_COMMAND_END);
  if (commandEnd) {
    const exitCode = commandEnd[1] ? Number.parseInt(commandEnd[1], 10) : 0;
    return exitCode === 0 ? { status: "open" } : { status: "error" };
  }

  if (SHELL_PROMPT.test(chunk)) return { status: "open" };

  return null;
}

/** Remove status sequences so they never reach the visible terminal. */
export function stripReportedStatus(chunk: string): string {
  if (!chunk || !chunk.includes("\x1b]633;AR;")) return chunk;
  return chunk.replace(AR_SEQUENCE_GLOBAL, "");
}

/**
 * Track DEC private mode 25 (cursor visibility) from the raw byte stream.
 * Hidden cursor is a strong affordance for "an interactive menu is open".
 */
const CURSOR_VISIBILITY_SEQUENCE = /\x1b\[\?25([hl])/g;

export function trackCursorVisibility(
  chunk: string,
  tracking: Map<number, boolean>,
  key: number
): void {
  for (const match of chunk.matchAll(CURSOR_VISIBILITY_SEQUENCE)) {
    tracking.set(key, match[1] === "l");
  }
}
