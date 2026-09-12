/**
 * Pane sensor: the only part of status detection that must live in the process
 * owning the PTY. It mirrors the screen, scans raw bytes for out-of-band
 * signals, watches the process tree, and publishes telemetry to the daemon.
 *
 * It never decides anything. Verdicts belong to the daemon
 * (`state.ts` / `derive.ts`), so this module stays free of policy and of any
 * knowledge about the UI.
 */

import type { AgentStatusBridge } from "./bridge";
import { findAgentProcess, kindForSessionKey } from "./identity";
import { PaneMirror } from "./mirror";
import {
  PROCESS_TABLE_SUPPORTED,
  buildIgnoredExecutables,
  detectToolActivity,
  readProcessEntries,
  type ProcessEntry
} from "./processTable";
import { createScanState, drainReports, scanChunk, type ScanState } from "./scan";
import type { AgentKind, PaneTelemetry } from "./types";

/** Sensor heartbeat. One tick covers every attached pane. */
export const SENSOR_TICK_MS = 1_000;
/** Minimum gap between process-table reads. */
export const PROCESS_PROBE_INTERVAL_MS = 1_000;
/**
 * Keep publishing while output is this fresh so the daemon's activity clock and
 * running window stay meaningful. Idle panes stop publishing and let the daemon
 * decay their verdict on its own.
 */
const KEEPALIVE_WINDOW_MS = 6_000;

type PaneSensor = {
  paneId: number;
  mirror: PaneMirror;
  scan: ScanState;
  cwd?: string;
  sessionKey?: string;
  /** Named agent, resolved from the process tree or the session. */
  agent: AgentKind;
  agentProcess?: string;
  lastOutputAt: number;
  lastContentSeq: number;
  toolRunning: boolean;
  foregroundProcesses: string[];
  /** Monotonic per pane, so the daemon can drop out-of-order reports. */
  reportSeq: number;
  dirty: boolean;
};

export type AgentStatusSensorDeps = {
  bridge: AgentStatusBridge;
  /** OS pid backing a PTY. */
  getPtyPid: (paneId: number) => number | null;
  /** Extra executables to treat as our own infrastructure. */
  ignoredExecutables?: readonly string[];
  log?: (message: string) => void;
};

export class AgentStatusSensor {
  private readonly panes = new Map<number, PaneSensor>();
  private readonly ignored: Set<string>;
  private timer: NodeJS.Timeout | null = null;
  private probing = false;
  private lastProbeAt = 0;
  private disposed = false;

  constructor(private readonly deps: AgentStatusSensorDeps) {
    this.ignored = buildIgnoredExecutables(deps.ignoredExecutables ?? []);
  }

  // ---------------------------------------------------------------- pane hooks

  attach(paneId: number, input: { cols: number; rows: number; cwd?: string; sessionKey?: string }): void {
    const existing = this.panes.get(paneId);
    existing?.mirror.dispose();
    this.panes.set(paneId, {
      paneId,
      mirror: new PaneMirror({ cols: input.cols, rows: input.rows }),
      scan: createScanState(),
      cwd: input.cwd ?? existing?.cwd,
      sessionKey: input.sessionKey ?? existing?.sessionKey,
      agent: existing?.agent ?? kindForSessionKey(input.sessionKey) ?? "unknown",
      agentProcess: existing?.agentProcess,
      lastOutputAt: Date.now(),
      lastContentSeq: 0,
      toolRunning: false,
      foregroundProcesses: [],
      reportSeq: 0,
      dirty: true
    });
    this.start();
  }

  /** Bind (or rebind) the session identity a pane belongs to. */
  bindSession(paneId: number, input: { sessionKey?: string; cwd?: string }): void {
    const pane = this.panes.get(paneId);
    if (!pane) return;
    if (input.sessionKey) {
      pane.sessionKey = input.sessionKey;
      // The session is a declared hint; the process tree still wins once it answers.
      if (pane.agent === "unknown") pane.agent = kindForSessionKey(input.sessionKey) ?? "unknown";
    }
    if (input.cwd) pane.cwd = input.cwd;
    pane.dirty = true;
  }

  resize(paneId: number, cols: number, rows: number): void {
    const pane = this.panes.get(paneId);
    if (!pane) return;
    pane.mirror.resize(cols, rows);
    pane.dirty = true;
  }

  detach(paneId: number): void {
    const pane = this.panes.get(paneId);
    if (!pane) return;
    pane.mirror.dispose();
    this.panes.delete(paneId);
    this.deps.bridge.forgetPane(paneId);
  }

  /**
   * Scan one chunk of PTY output and mirror it.
   *
   * @returns the bytes to forward to the terminal, with agent status sequences
   *          stripped so the renderer never prints them.
   */
  ingest(paneId: number, chunk: string): string {
    const pane = this.panes.get(paneId);
    if (!pane || !chunk) return chunk;
    const forwarded = scanChunk(pane.scan, chunk);
    pane.mirror.write(forwarded);
    pane.lastOutputAt = Date.now();
    pane.dirty = true;

    for (const report of drainReports(pane.scan)) {
      // An explicit status sequence is exact evidence, so it skips the screen
      // heuristics entirely and becomes the pane's authority.
      pane.reportSeq += 1;
      this.deps.bridge.publishNativeReport({
        paneId,
        source: "agent-resume:status-sequence",
        agent: pane.agent,
        state: report.state,
        seq: pane.reportSeq,
        sessionKey: pane.sessionKey
      });
    }
    return forwarded;
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const pane of this.panes.values()) pane.mirror.dispose();
    this.panes.clear();
  }

  get paneCount(): number {
    return this.panes.size;
  }

  // ------------------------------------------------------------------ internals

  private start(): void {
    if (this.timer || this.disposed) return;
    this.timer = setInterval(() => this.tick(), SENSOR_TICK_MS);
    this.timer.unref?.();
  }

  private tick(): void {
    if (this.disposed) return;
    const now = Date.now();
    void this.refreshProcessActivity(now);
    for (const pane of this.panes.values()) {
      const active = now - pane.lastOutputAt < KEEPALIVE_WINDOW_MS;
      const changed = pane.mirror.contentSeq !== pane.lastContentSeq;
      if (!pane.dirty && !changed && !active) continue;
      void this.publishWhenParsed(pane);
    }
  }

  /**
   * Snapshot and publish, once the mirror has parsed everything written so far.
   * xterm parses asynchronously, so reading without flushing would trail the
   * pane by one frame and make "just finished" verdicts late.
   */
  private async publishWhenParsed(pane: PaneSensor): Promise<void> {
    await pane.mirror.flush();
    if (this.disposed || this.panes.get(pane.paneId) !== pane) return;
    this.publish(pane);
  }

  private publish(pane: PaneSensor): void {
    const now = Date.now();
    pane.lastContentSeq = pane.mirror.contentSeq;
    pane.dirty = false;
    const telemetry: PaneTelemetry = {
      paneId: pane.paneId,
      at: now,
      agent: pane.agent,
      screenText: pane.mirror.snapshotText(),
      oscTitle: pane.scan.oscTitle,
      oscProgress: pane.scan.oscProgress,
      cursorHidden: pane.scan.cursorHidden,
      toolRunning: pane.toolRunning,
      foregroundProcesses: pane.foregroundProcesses,
      lastOutputAt: pane.lastOutputAt
    };
    if (pane.agentProcess) telemetry.agentProcess = pane.agentProcess;
    const ptyPid = this.deps.getPtyPid(pane.paneId);
    if (ptyPid != null) telemetry.ptyPid = ptyPid;
    if (pane.cwd) telemetry.cwd = pane.cwd;
    if (pane.sessionKey) telemetry.sessionKey = pane.sessionKey;
    this.deps.bridge.publishTelemetry(telemetry);
  }

  /**
   * Refresh Tier 1 evidence: is a command running beneath each pane?
   *
   * One `ps` read serves every pane; the result lands on the next tick as
   * evidence rather than blocking the sensor.
   */
  private async refreshProcessActivity(now: number): Promise<void> {
    if (this.probing || this.disposed || !PROCESS_TABLE_SUPPORTED || !this.panes.size) return;
    if (now - this.lastProbeAt < PROCESS_PROBE_INTERVAL_MS) return;
    this.probing = true;
    this.lastProbeAt = now;
    try {
      const entries: ProcessEntry[] = await readProcessEntries();
      if (this.disposed) return;
      for (const pane of this.panes.values()) {
        const ptyPid = this.deps.getPtyPid(pane.paneId);
        if (ptyPid == null) continue;
        // Identity first: the agent is never counted as a foreground tool.
        const agent = findAgentProcess(entries, ptyPid);
        const kind = agent?.kind ?? kindForSessionKey(pane.sessionKey) ?? "unknown";
        const activity = detectToolActivity({
          entries,
          ptyPid,
          ignoreExecutables: this.ignored,
          agentPid: agent?.entry.pid ?? null
        });
        if (kind !== pane.agent || agent?.entry.command !== pane.agentProcess) {
          pane.agent = kind;
          pane.agentProcess = agent?.entry.command;
          pane.dirty = true;
        }
        pane.foregroundProcesses = activity.processes.slice(0, 32);
        if (activity.active !== pane.toolRunning) {
          pane.toolRunning = activity.active;
          pane.dirty = true;
        }
      }
    } catch {
      // A failed probe must never disturb status: keep the previous evidence.
    } finally {
      this.probing = false;
    }
  }
}
