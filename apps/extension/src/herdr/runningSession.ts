import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { HcTerminal } from "./types";

/**
 * Which agent session a live terminal is running *right now*.
 *
 * `alma.session` is a label someone wrote once; a TUI started with `/new` inside the same PTY
 * keeps the old label while running a brand new session. omp/pi write a per-TTY record naming
 * the session currently attached to that terminal, so pid → tty → session is exact.
 */
export interface RunningTtyRecord {
  /** Working directory recorded for the session. */
  cwd: string;
  sessionId: string;
  sessionFile: string;
}

export interface RunningSessionLookup {
  /** The record for the session this terminal currently runs, or undefined if unknown. */
  record(term: HcTerminal, provider: string): RunningTtyRecord | undefined;
  /** Convenience: the session id, or undefined. */
  resolve(term: HcTerminal, provider: string): string | undefined;
}

const SESSION_FILE_RE = /^[^_]+_(.+)\.jsonl$/;

export function readRunningTtyRecord(agentHome: string, tty: string): RunningTtyRecord | undefined {
  if (!tty) {
    return undefined;
  }
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(agentHome, "terminal-sessions", tty), "utf8");
  } catch {
    return undefined;
  }
  const [cwd = "", sessionFile = ""] = raw.split("\n");
  const sessionId = SESSION_FILE_RE.exec(path.basename(sessionFile.trim()))?.[1]?.trim();
  if (!sessionId) {
    return undefined;
  }
  return { cwd: cwd.trim(), sessionId, sessionFile: sessionFile.trim() };
}

/** `ps` prints the controlling terminal of each pid (`ttys002`, `??` when there is none). */
export function ttyOfTerminal(term: HcTerminal): string | undefined {
  const pids = [...new Set([term.foreground?.pid, term.pid])].filter(
    (pid): pid is number => typeof pid === "number" && pid > 0
  );
  if (pids.length === 0) {
    return undefined;
  }
  let out: string;
  try {
    out = execFileSync("ps", ["-o", "pid=,tty=", "-p", pids.join(",")], {
      encoding: "utf8",
      timeout: 2000
    });
  } catch {
    return undefined;
  }
  for (const line of out.split("\n")) {
    const tty = /^\s*\d+\s+(\S+)/.exec(line)?.[1];
    if (tty && tty !== "??") {
      return tty;
    }
  }
  return undefined;
}

/**
 * Builds a resolver over provider homes. Providers without per-TTY session records
 * (claude, codex, ...) resolve to undefined, which callers read as "the label is all we know".
 *
 * Only the pid → tty hop is cached: it is the `ps` call worth avoiding. The record file itself
 * is re-read every time because `/new` replaces it without changing the pid or the tty, so a
 * cached session id would freeze on the first session the terminal ever ran.
 */
export function createRunningSessionLookup(
  homes: Partial<Record<string, string>>,
  ttyOf: (term: HcTerminal) => string | undefined = ttyOfTerminal
): RunningSessionLookup {
  const ttyCache = new Map<string, string | undefined>();

  const ttyFor = (term: HcTerminal): string | undefined => {
    const key = `${term.address}|${term.state}|${term.pid ?? ""}|${term.foreground?.pid ?? ""}`;
    if (ttyCache.has(key)) {
      return ttyCache.get(key);
    }
    const tty = term.state === "live" ? ttyOf(term) : undefined;
    ttyCache.set(key, tty);
    return tty;
  };

  const record = (term: HcTerminal, provider: string): RunningTtyRecord | undefined => {
    const home = homes[provider];
    if (!home) {
      return undefined;
    }
    const tty = ttyFor(term);
    return tty ? readRunningTtyRecord(home, tty) : undefined;
  };

  return {
    record,
    resolve: (term, provider) => record(term, provider)?.sessionId
  };
}

export function defaultRunningSessionHomes(): Record<string, string> {
  // Only omp writes `<home>/terminal-sessions/<tty>`; pi, prime, codex and agy do not, so they
  // stay unresolved ("the label is all we know") rather than being guessed from file mtimes.
  return { omp: path.join(os.homedir(), ".omp", "agent") };
}
