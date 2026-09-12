/**
 * Raw PTY byte scanning.
 *
 * The sensor sees every byte a pane produces, so this is where out-of-band
 * signals are read: the explicit agent status sequence, terminal title and
 * progress (OSC), and cursor visibility (DEC private mode 25).
 *
 * `scanChunk` also *returns* the bytes that should keep flowing to xterm, with
 * the agent status sequence removed — the verdict is captured here, and the
 * renderer must never print the escape sequence. Sequences split across chunks
 * are held back in `carry` instead of being forwarded as garbage.
 *
 * Electron-free and dependency-free: pure string analysis.
 */

import type { AgentState } from "./types";

/** A status the agent reported about itself. */
export type ReportedAgentState = {
  state: AgentState;
  detail?: string;
};

export type ScanState = {
  oscTitle: string;
  oscProgress: string;
  /** DEC private mode 25: hidden cursor is an affordance for an open menu. */
  cursorHidden: boolean;
  /** Reports seen since the last drain. */
  reports: ReportedAgentState[];
  /** Tail of a sequence that was cut off by the chunk boundary. */
  carry: string;
};

/** Agent Resume custom sequence: `ESC ] 633 ; AR ; <state> [ ; <detail> ] ST`. */
const AR_SEQUENCE = /\x1b\]633;AR;(awaiting|running|idle)(?:;([^\x07\x1b]*))?(?:\x07|\x1b\\)/g;
const AR_SEQUENCE_GLOBAL = /\x1b\]633;AR;(?:awaiting|running|idle)(?:;[^\x07\x1b]*)?(?:\x07|\x1b\\)/g;
/** OSC 0 / OSC 2 set the terminal title; agents put their spinner state there. */
const OSC_TITLE = /\x1b\](?:0|2);([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
/** OSC 9;4 progress reports, e.g. `9;4;0` for "done". */
const OSC_PROGRESS = /\x1b\]9;4;([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
const CURSOR_VISIBILITY = /\x1b\[\?25([hl])/g;
const OSC_START = "\x1b]";
const MAX_CARRY_CHARS = 4_096;

export function createScanState(): ScanState {
  return { oscTitle: "", oscProgress: "", cursorHidden: false, reports: [], carry: "" };
}

/** True when the OSC starting at `from` has a BEL or ST terminator. */
function hasTerminator(input: string, from: number): boolean {
  for (let index = from + OSC_START.length; index < input.length; index += 1) {
    const char = input[index];
    if (char === "\x07") return true;
    if (char === "\x1b" && input[index + 1] === "\\") return true;
  }
  return false;
}

/**
 * Read every signal out of one chunk.
 *
 * @returns the bytes to forward to the terminal, with agent status sequences
 *          stripped and incomplete trailing sequences withheld.
 */
export function scanChunk(state: ScanState, chunk: string): string {
  if (!chunk) return "";
  let input = chunk;
  if (state.carry) {
    input = state.carry + chunk;
    state.carry = "";
  }

  const lastStart = input.lastIndexOf(OSC_START);
  if (lastStart >= 0 && !hasTerminator(input, lastStart)) {
    const partial = input.slice(lastStart);
    input = input.slice(0, lastStart);
    // A runaway "sequence" is not a sequence: drop it rather than growing forever.
    state.carry = partial.length > MAX_CARRY_CHARS ? "" : partial;
  }

  for (const match of input.matchAll(OSC_TITLE)) state.oscTitle = match[1] ?? "";
  for (const match of input.matchAll(OSC_PROGRESS)) state.oscProgress = match[1] ?? "";
  for (const match of input.matchAll(CURSOR_VISIBILITY)) state.cursorHidden = match[1] === "l";
  for (const match of input.matchAll(AR_SEQUENCE)) {
    const detail = match[2]?.trim() || undefined;
    state.reports.push({ state: arStateToAgentState(match[1] ?? ""), detail });
  }

  const forwarded = input.includes("\x1b]633;AR;") ? input.replace(AR_SEQUENCE_GLOBAL, "") : input;
  return forwarded;}

export function drainReports(state: ScanState): ReportedAgentState[] {
  if (!state.reports.length) return [];
  const reports = state.reports;
  state.reports = [];
  return reports;
}

/** awaiting → blocked, running → working, idle → idle. */
function arStateToAgentState(value: string): AgentState {
  if (value === "awaiting") return "blocked";
  if (value === "running") return "working";
  return "idle";
}
