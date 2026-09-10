/**
 * Tier 1 (main process) — process-tree probing IPC.
 *
 * Reads the OS process table once per batch and answers, for each PTY,
 * whether the agent beneath it is executing a command. This is the free,
 * deterministic signal that removes most guesswork from status detection.
 *
 * See `processProbe.ts` for the decision logic and the measured baselines.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { safeHandle } from "../ipcUtils";
import {
  buildChildIndex,
  collectDescendants,
  parseProcessTable,
  type ProcessActivity
} from "./processProbe";
import { StatusJudge } from "./statusJudge";
import type { JudgeRequest, JudgeVerdict } from "./prompt";

const execFileAsync = promisify(execFile);

/** `comm` is the executable path and is the last field, so spaces are safe. */
const PS_ARGS = ["-Ao", "pid=,ppid=,comm="];

/**
 * PTYs only exist on POSIX platforms here. Elsewhere the layer disables
 * itself instead of guessing, and status falls back to the other tiers.
 */
export const PROCESS_PROBE_SUPPORTED = process.platform === "darwin" || process.platform === "linux";

export type ProcessProbeResult = Record<number, ProcessActivity>;

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

/** Read + parse the process table. Exported for tests and diagnostics. */
export async function readProcessEntries(): Promise<ReturnType<typeof parseProcessTable>> {
  const { stdout } = await execFileAsync("ps", PS_ARGS, { maxBuffer: 8 * 1024 * 1024 });
  return parseProcessTable(stdout);
}

export function registerSessionStatusIpc(deps: {
  /** node-pty id → OS pid. Returns null when the PTY is gone. */
  getPtyPid: (ptyId: number) => number | null;
  /** Extra executables to treat as our own infrastructure. */
  ignoredExecutables?: readonly string[];
  /** Tier 1.5 adjudicator dependencies (settings + usage DB). */
  judge: ConstructorParameters<typeof StatusJudge>[0];
}): void {
  safeHandle(
    "sessionStatus:probeProcesses",
    async (_event, args: { ptyIds?: unknown }): Promise<ProcessProbeResult> => {
      const result: ProcessProbeResult = {};

      const ptyIds = Array.isArray(args?.ptyIds)
        ? args.ptyIds.filter((id): id is number => typeof id === "number" && Number.isInteger(id))
        : [];
      if (!ptyIds.length) return result;

      // Unsupported platform: report "no signal" (idle) rather than guessing.
      if (!PROCESS_PROBE_SUPPORTED) {
        for (const ptyId of ptyIds) result[ptyId] = { active: false, processes: [] };
        return result;
      }

      let entries: Awaited<ReturnType<typeof readProcessEntries>>;
      try {
        entries = await readProcessEntries();
      } catch {
        // `ps` unavailable or output unreadable: degrade to "no signal".
        for (const ptyId of ptyIds) result[ptyId] = { active: false, processes: [] };
        return result;
      }

      const ignored = buildIgnoredExecutables(deps.ignoredExecutables ?? []);
      const byPid = new Map(entries.map((entry) => [entry.pid, entry]));
      const index = buildChildIndex(entries);

      for (const ptyId of ptyIds) {
        const ptyPid = deps.getPtyPid(ptyId);
        if (ptyPid == null) {
          result[ptyId] = { active: false, processes: [] };
          continue;
        }

        // Same rule as detectToolActivity, but reusing the shared indices so a
        // batch of N panes costs one table walk instead of N.
        const directChildren = new Set(index.get(ptyPid) ?? []);
        const processes: string[] = [];
        for (const pid of collectDescendants(index, ptyPid)) {
          if (directChildren.has(pid)) continue;
          const entry = byPid.get(pid);
          if (!entry || ignored.has(entry.command)) continue;
          processes.push(entry.command);
        }
        result[ptyId] = { active: processes.length > 0, processes };
      }

      return result;
    }
  );

  const judge = new StatusJudge(deps.judge);

  safeHandle(
    "sessionStatus:judgeScreens",
    async (_event, args: { requests?: unknown }): Promise<JudgeVerdict[]> => {
      const requests = normalizeJudgeRequests(args?.requests);
      if (!requests.length) return [];
      try {
        return await judge.judge(requests);
      } catch {
        // The judge already fails safe internally; this guards the IPC edge.
        return requests.map((request) => ({ paneKey: request.paneKey, awaiting: false }));
      }
    }
  );
}

/** Defensive shaping of renderer input — never trust IPC payloads. */
function normalizeJudgeRequests(raw: unknown): JudgeRequest[] {
  if (!Array.isArray(raw)) return [];
  const requests: JudgeRequest[] = [];
  for (const item of raw.slice(0, 32)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const paneKey = typeof record.paneKey === "string" ? record.paneKey.trim().slice(0, 200) : "";
    if (!paneKey) continue;
    const screenText = typeof record.screenText === "string" ? record.screenText : "";
    const silentMs = typeof record.silentMs === "number" && Number.isFinite(record.silentMs)
      ? Math.max(0, record.silentMs)
      : 0;
    requests.push({ paneKey, screenText, silentMs, toolRunning: record.toolRunning === true });
  }
  return requests;
}
