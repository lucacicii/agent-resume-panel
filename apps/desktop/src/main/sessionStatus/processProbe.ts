/**
 * Tier 1 — process-tree probe.
 *
 * An agent that is executing a tool command has a descendant process that is
 * neither the agent itself nor infrastructure we injected. That is a
 * deterministic, zero-cost signal: it settles "the agent is running a command"
 * without any screen scraping or LLM call.
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
 * Pure module: parses text, takes no I/O. The caller supplies `ps` output.
 */

export type ProcessEntry = {
  pid: number;
  ppid: number;
  /** Executable path. May contain spaces (e.g. `/Applications/Agent Resume.app/…`). */
  command: string;
};

export type ProcessActivity = {
  /** True when a non-infrastructure process is running beneath the agent. */
  active: boolean;
  /** Executable paths of the processes that made it active, for diagnostics. */
  processes: string[];
};

/**
 * Parse `ps -Ao pid=,ppid=,comm=`.
 *
 * `comm` is the last field, so everything after `ppid` — including paths with
 * spaces — belongs to it. Anchoring greedily on `(.+)$` is what makes
 * `/Applications/Agent Resume.app/…` parse as one executable.
 */
export function parseProcessTable(output: string): ProcessEntry[] {
  const entries: ProcessEntry[] = [];
  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    const command = match[3].trim();
    if (!Number.isFinite(pid) || !Number.isFinite(ppid) || !command) continue;
    entries.push({ pid, ppid, command });
  }
  return entries;
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
 * Decide whether the agent under `ptyPid` is executing a command.
 *
 * The agent is the direct child of the PTY shell; anything deeper is a tool
 * process. Infrastructure we injected ourselves (the MCP bridge runs as our
 * own executable) is excluded, otherwise every idle pane reports busy.
 */
export function detectToolActivity(
  entries: readonly ProcessEntry[],
  ptyPid: number,
  ignoreExecutables: ReadonlySet<string>
): ProcessActivity {
  const byPid = new Map(entries.map((entry) => [entry.pid, entry]));
  const index = buildChildIndex(entries);
  const directChildren = new Set(index.get(ptyPid) ?? []);

  const processes: string[] = [];
  for (const pid of collectDescendants(index, ptyPid)) {
    // The agent itself sits directly under the PTY shell.
    if (directChildren.has(pid)) continue;
    const entry = byPid.get(pid);
    if (!entry) continue;
    if (ignoreExecutables.has(entry.command)) continue;
    processes.push(entry.command);
  }

  return { active: processes.length > 0, processes };
}
