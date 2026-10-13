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
type ReportedAgentState = {
  state: AgentState;
  detail?: string;
  /** `osc7501:<app>` when a program reported over the protocol. */
  source?: string;
};

export type ScanState = {
  oscTitle: string;
  oscProgress: string;
  /** DEC private mode 25: hidden cursor is an affordance for an open menu. */
  cursorHidden: boolean;
  /** Reports seen since the last drain. */
  reports: ReportedAgentState[];
  /** True when a program asked for OSC 7501 feature detection since the last drain. */
  programStatusQuery: boolean;
  /** Tail of a sequence that was cut off by the chunk boundary. */
  carry: string;
};

/** Agent Resume custom sequence: `ESC ] 633 ; AR ; <state> [ ; <detail> ] ST`. */
const AR_SEQUENCE = /\x1b\]633;AR;(awaiting|running|idle)(?:;([^\x07\x1b]*))?(?:\x07|\x1b\\)/g;
const AR_SEQUENCE_GLOBAL = /\x1b\]633;AR;(?:awaiting|running|idle)(?:;[^\x07\x1b]*)?(?:\x07|\x1b\\)/g;
/** OSC 7501 Program Status Protocol: `ESC ] 7501 ; key=value [:…] ST`. */
const PROGRAM_STATUS = /\x1b\]7501;([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
const PROGRAM_STATUS_GLOBAL = /\x1b\]7501;[^\x07\x1b]*(?:\x07|\x1b\\)/g;
/** OSC 0 / OSC 2 set the terminal title; agents put their spinner state there. */
const OSC_TITLE = /\x1b\](?:0|2);([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
/** OSC 9;4 progress reports, e.g. `9;4;0` for "done". */
const OSC_PROGRESS = /\x1b\]9;4;([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
const CURSOR_VISIBILITY = /\x1b\[\?25([hl])/g;
const OSC_START = "\x1b]";
const MAX_CARRY_CHARS = 4_096;
/** Spec cap on one sequence, `OSC` through `ST`; a longer match is ignored whole. */
const PROGRAM_STATUS_MAX_SEQUENCE = 4_096;
/**
 * The reply a program waits for before it starts reporting. The spec only
 * requires `?`; its optional `states`/`kinds` lists would restate the defaults.
 */
export const PROGRAM_STATUS_REPLY = "\x1b]7501;?\x1b\\";

export function createScanState(): ScanState {
  return {
    oscTitle: "",
    oscProgress: "",
    cursorHidden: false,
    reports: [],
    programStatusQuery: false,
    carry: ""
  };
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
  for (const match of input.matchAll(PROGRAM_STATUS)) {
    // A report past the spec cap is discarded whole, feature detection included.
    if ((match[0] ?? "").length > PROGRAM_STATUS_MAX_SEQUENCE) continue;
    const body = match[1] ?? "";
    if (!body) continue;
    if (body.startsWith("?")) {
      state.programStatusQuery = true;
      continue;
    }
    const report = parseProgramStatus(body);
    if (report) state.reports.push(report);
  }

  let forwarded = input;
  if (forwarded.includes("\x1b]633;AR;")) forwarded = forwarded.replace(AR_SEQUENCE_GLOBAL, "");
  if (forwarded.includes("\x1b]7501;")) forwarded = forwarded.replace(PROGRAM_STATUS_GLOBAL, "");
  return forwarded;
}

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

/** True when a program asked for feature detection since the last drain. */
export function drainProgramStatusQuery(state: ScanState): boolean {
  if (!state.programStatusQuery) return false;
  state.programStatusQuery = false;
  return true;
}

/** Keys are lowercase words; values stay inside the spec's character set. */
const PROGRAM_STATUS_KEY = /^[a-z]{1,16}$/;
const PROGRAM_STATUS_VALUE = /^[A-Za-z0-9_.,+/=-]*$/;
const PROGRAM_STATUS_APP = /^[A-Za-z0-9_.+-]{1,32}$/;

/**
 * Turn one report body into a status, or null when it must not touch the pane.
 *
 * Only the root record owns a pane — a report carrying an `id` describes a
 * child record — and a state this build does not know discards the report whole
 * rather than being guessed at, exactly as the spec requires.
 */
function parseProgramStatus(body: string): ReportedAgentState | null {
  const pairs: Record<string, string | undefined> = {};
  for (const pair of body.split(":")) {
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const key = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (!PROGRAM_STATUS_KEY.test(key) || !PROGRAM_STATUS_VALUE.test(value)) continue;
    pairs[key] = value;
  }
  const id = pairs.id;
  if (id !== undefined && id !== "") return null;
  const state = programStatusToAgentState(pairs.state ?? "");
  if (!state) return null;
  const app = pairs.app;
  return {
    state,
    detail: pairs.kind?.trim() || undefined,
    source: app && PROGRAM_STATUS_APP.test(app) ? `osc7501:${app}` : "osc7501"
  };
}

/**
 * OSC 7501 states in the panel's vocabulary. `done` finished a piece of work
 * the user has not seen, which is the resting state the Stop hooks already
 * report; `error` stopped the run with something to look at, which only
 * `blocked` surfaces. `clear` removes every record, so nothing is working.
 */
function programStatusToAgentState(value: string): AgentState | null {
  switch (value) {
    case "working":
      return "working";
    case "blocked":
    case "error":
      return "blocked";
    case "idle":
    case "done":
    case "clear":
      return "idle";
    default:
      return null;
  }
}
