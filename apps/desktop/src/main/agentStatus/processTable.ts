/**
 * Process-table probe.
 *
 * Two questions are answered here:
 *   - is a command executing in a pane's foreground (so the agent cannot be
 *     waiting on a human)? — job control, not guesswork; and
 *   - which processes exist at all, so `identity.ts` can name the agent.
 *
 * Empirically measured on this machine (see scripts/process-probe-baseline.mjs):
 *
 *   agent idle  →  pi: [pi, Agent Resume×2]   claude: [claude, Agent Resume×2]   codex: [codex]
 *   agent busy  →  pi: […, /bin/bash, sleep, …]
 *
 * The resident `Agent Resume` entries are the MCP bridge we register for the
 * user, so they must be filtered by our own executable path or every idle pane
 * would look busy.
 *
 * Parsing is pure; `readProcessEntries` is the only function that touches the OS.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

export type ProcessEntry = {
  pid: number;
  ppid: number;
  /** Process group id. */
  pgid: number;
  /**
   * Foreground process group of the entry's controlling terminal, or 0 when it
   * has none. Every process on one terminal reports the same value, so the pty's
   * shell row tells us what is running in the foreground.
   */
  tpgid: number;
  /** Controlling terminal, e.g. `ttys004`; `??` when there is none. */
  tty: string;
  /** Executable path. May contain spaces (e.g. `/Applications/Agent Resume.app/…`). */
  command: string;
  /** Full argv, when the second pass provided it. */
  argv?: string[];
};

export type ProcessActivity = {
  /** True when a non-infrastructure command is running in the foreground. */
  active: boolean;
  /** Executable paths of the processes that made it active, for diagnostics. */
  processes: string[];
};

/**
 * Parse `ps -Ao pid=,ppid=,pgid=,tpgid=,tty=,comm=`.
 *
 * `comm` is the last field, so everything after `tty` — including paths with
 * spaces — belongs to it. Anchoring greedily on `(.+)$` is what makes
 * `/Applications/Agent Resume.app/…` parse as one executable.
 */
export function parseProcessTable(output: string): ProcessEntry[] {
  const entries: ProcessEntry[] = [];
  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    const pgid = Number(match[3]);
    const tpgid = Number(match[4]);
    const command = match[6].trim();
    if (!Number.isFinite(pid) || !Number.isFinite(ppid) || !command) continue;
    entries.push({
      pid,
      ppid,
      pgid: Number.isFinite(pgid) ? pgid : 0,
      tpgid: Number.isFinite(tpgid) ? tpgid : 0,
      tty: match[5],
      command
    });
  }
  return entries;
}

/**
 * Parse `ps -Ao pid=,args=` into pid → argv.
 *
 * Tokens are split on whitespace, so an executable path containing spaces is
 * over-split. That only affects argv[0]; identity falls back to `comm`, which
 * is parsed unambiguously above.
 */
export function parseArgvTable(output: string): Map<number, string[]> {
  const byPid = new Map<number, string[]>();
  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    if (!Number.isFinite(pid)) continue;
    byPid.set(pid, match[2].trim().split(/\s+/));
  }
  return byPid;
}

/** Index children by parent for repeated traversal. */
export function buildChildIndex(entries: readonly ProcessEntry[]): Map<number, number[]> {
  const index = new Map<number, number[]>();
  for (const entry of entries) {
    const bucket = index.get(entry.ppid);
    if (bucket) bucket.push(entry.pid);
    else index.set(entry.ppid, [entry.pid]);
  }
  return index;
}

/** Depth-first descendant pids of `root`, excluding `root` itself. */
export function collectDescendants(index: ReadonlyMap<number, number[]>, root: number): number[] {
  const found: number[] = [];
  const stack = [...(index.get(root) ?? [])];
  const guard = new Set<number>();
  while (stack.length) {
    const pid = stack.pop()!;
    if (guard.has(pid)) continue; // defensive: a corrupt table could cycle
    guard.add(pid);
    found.push(pid);
    for (const child of index.get(pid) ?? []) stack.push(child);
  }
  return found;
}

/**
 * Processes in the pty's foreground process group.
 *
 * This is the deterministic version of "is something running under the agent":
 * the kernel tracks job control, so we never have to infer it.
 */
export function foregroundProcesses(
  entries: readonly ProcessEntry[],
  ptyPid: number
): { pgid: number; processes: ProcessEntry[] } {
  const owner = entries.find((entry) => entry.pid === ptyPid);
  const pgid = owner?.tpgid ?? 0;
  if (!pgid) return { pgid: 0, processes: [] };
  return { pgid, processes: entries.filter((entry) => entry.pgid === pgid) };
}

/**
 * Decide whether a command is executing in the pane's foreground.
 *
 * The shell, the agent itself, and infrastructure we injected (the MCP bridge
 * runs as our own executable) are not commands: anything else in the foreground
 * group is. A probe that cannot see a terminal reports "nothing running", which
 * is the safe direction — the derivation falls back to output activity and the
 * screen instead of suppressing a real "blocked".
 */
export function detectToolActivity(input: {
  entries: readonly ProcessEntry[];
  ptyPid: number;
  ignoreExecutables: ReadonlySet<string>;
  /** The agent owning the pane; it is not a tool. */
  agentPid?: number | null;
}): ProcessActivity {
  const { processes } = foregroundProcesses(input.entries, input.ptyPid);
  const tools = processes.filter((entry) => {
    if (entry.pid === input.ptyPid) return false;
    if (entry.pid === input.agentPid) return false;
    if (input.ignoreExecutables.has(entry.command)) return false;
    return true;
  });
  return { active: tools.length > 0, processes: tools.map((entry) => entry.command) };
}

/** `comm` and the executable path are the last field in both formats. */
const PS_TABLE_ARGS = ["-Ao", "pid=,ppid=,pgid=,tpgid=,tty=,comm="];
const PS_ARGV_ARGS = ["-Ao", "pid=,args="];
const MAX_PS_BYTES = 8 * 1024 * 1024;
const execFileAsync = promisify(execFile);

/**
 * PTYs and process groups only exist on POSIX platforms here. Elsewhere the
 * layer disables itself instead of guessing.
 */
export const PROCESS_TABLE_SUPPORTED = process.platform === "darwin" || process.platform === "linux";

/**
 * Read the process table.
 *
 * Two `ps` invocations, not one: `comm` can contain spaces and `args` cannot be
 * separated from it unambiguously, so each format keeps its own last column.
 */
export async function readProcessEntries(): Promise<ProcessEntry[]> {
  const [table, argvTable] = await Promise.all([
    execFileAsync("ps", PS_TABLE_ARGS, { maxBuffer: MAX_PS_BYTES }),
    execFileAsync("ps", PS_ARGV_ARGS, { maxBuffer: MAX_PS_BYTES })
  ]);
  const argvByPid = parseArgvTable(argvTable.stdout);
  return parseProcessTable(table.stdout).map((entry) => {
    const argv = argvByPid.get(entry.pid);
    return argv ? { ...entry, argv } : entry;
  });
}

/**
 * Executables that belong to this application rather than to the agent.
 *
 * The MCP bridge we register runs *as our own executable*, so an agent that
 * has it configured keeps one or two of them as permanent children. Without
 * this filter every idle pane would look busy.
 */
export function buildIgnoredExecutables(extra: readonly string[] = []): Set<string> {
  const ignored = new Set<string>();
  const push = (value: string | undefined) => {
    const trimmed = value?.trim();
    if (trimmed) ignored.add(trimmed);
  };
  push(process.execPath);
  for (const path of extra) push(path);
  return ignored;
}
