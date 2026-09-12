/**
 * Discovery of agents running outside this app.
 *
 * Panes this app spawns are known by construction; an agent running in VS Code,
 * iTerm or tmux is not. The daemon can still see it in the process table, and
 * what it can say is honest: this agent exists, on this terminal, and it is (or
 * is not) executing a command right now. Screen rules are impossible — we do not
 * own those bytes — so an external pane never gets a screen verdict.
 *
 * External panes use a negative id derived from the pid: PTY ids are positive, so
 * the two spaces cannot collide.
 */

import { kindForProcess } from "./identity";
import { foregroundProcesses, readProcessEntries, type ProcessEntry } from "./processTable";
import type { AgentKind, PaneTelemetry } from "./types";

/** How often the process table is rescanned. */
export const DISCOVERY_INTERVAL_MS = 5_000;

/** External pane id for a pid. */
export function externalPaneId(pid: number): number {
  return -pid;
}

/** True when a pid belongs to a process we already track through a pty. */
function isOwned(entry: ProcessEntry, byPid: Map<number, ProcessEntry>, ownedPids: ReadonlySet<number>): boolean {
  let current: ProcessEntry | undefined = entry;
  const guard = new Set<number>();
  while (current) {
    if (ownedPids.has(current.pid)) return true;
    if (guard.has(current.pid)) return false;
    guard.add(current.pid);
    current = byPid.get(current.ppid);
  }
  return false;
}

/**
 * Agents visible in the process table that belong to no tracked pane.
 *
 * Only interactive agents count: a process without a controlling terminal is
 * not a pane anybody can look at, so reporting it would be noise.
 */
export function discoverExternalAgents(
  entries: readonly ProcessEntry[],
  ownedPids: ReadonlySet<number>
): PaneTelemetry[] {
  const byPid = new Map(entries.map((entry) => [entry.pid, entry]));
  const now = Date.now();
  const found: PaneTelemetry[] = [];

  for (const entry of entries) {
    if (entry.tty === "??" || !entry.tty) continue;
    const agent: AgentKind | null = kindForProcess(entry);
    if (!agent) continue;
    if (isOwned(entry, byPid, ownedPids)) continue;

    // Everything else on this terminal: the foreground group tells us whether a
    // command is running under the agent.
    const { processes } = foregroundProcesses(entries, entry.pid);
    const tools = processes.filter((candidate) => candidate.pid !== entry.pid);

    found.push({
      paneId: externalPaneId(entry.pid),
      ptyPid: entry.pid,
      agent,
      toolRunning: tools.length > 0,
      foregroundProcesses: tools.map((tool) => tool.command).slice(0, 32),
      lastOutputAt: now,
      at: now
    });
  }
  return found;
}

export type DiscoveryScanner = {
  /** Run one scan and apply it to the state. */
  scan: () => Promise<void>;
  dispose: () => void;
};

export function createDiscoveryScanner(input: {
  apply: (telemetry: PaneTelemetry) => void;
  forget: (paneId: number) => void;
  ownedPids: () => ReadonlySet<number>;
  log?: (message: string) => void;
  intervalMs?: number;
}): DiscoveryScanner {
  const log = input.log ?? (() => undefined);
  const intervalMs = input.intervalMs ?? DISCOVERY_INTERVAL_MS;
  let known = new Set<number>();
  let running = false;
  let disposed = false;

  const scan = async (): Promise<void> => {
    if (running || disposed) return;
    running = true;
    try {
      const entries = await readProcessEntries();
      if (disposed) return;
      const found = discoverExternalAgents(entries, input.ownedPids());
      const next = new Set(found.map((pane) => pane.paneId));
      for (const pane of found) input.apply(pane);
      for (const paneId of known) {
        if (!next.has(paneId)) input.forget(paneId);
      }
      if (known.size !== next.size) {
        log(`discovery: ${next.size} agent(s) outside this app`);
      }
      known = next;
    } catch {
      // A failed scan keeps the previous picture; the next one will correct it.
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void scan(), intervalMs);
  timer.unref?.();

  return {
    scan,
    dispose() {
      disposed = true;
      clearInterval(timer);
    }
  };
}
