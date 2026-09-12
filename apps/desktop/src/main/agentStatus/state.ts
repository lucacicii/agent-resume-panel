/**
 * In-memory status state for the daemon: telemetry frames, native reports, the
 * settled snapshot, and its on-disk subset.
 *
 * Verdict derivation lives in `derive.ts`; this module owns the bookkeeping
 * around it — per-pane hysteresis, sequence ordering, persistence, and the
 * snapshot shape subscribers see.
 */

import type { AgentStatusPaths } from "./paths";
import { readStateFile, writeStateFile } from "./endpoint";
import {
  advanceHysteresis,
  createHysteresis,
  evaluateStatus,
  screenHitFor,
  type StatusHysteresis,
  type Verdict
} from "./derive";
import type {
  AgentKind,
  AgentState,
  DetectionExplain,
  NativeReport,
  PaneAuthority,
  PaneStatus,
  PaneTelemetry,
  StatusSnapshot
} from "./types";
import { AGENT_STATUS_API_VERSION } from "./types";

const PERSIST_DEBOUNCE_MS = 300;
const STATE_FILE_VERSION = 1;

type NativeRecord = {
  source: string;
  agent: AgentKind;
  state: AgentState;
  seq: number;
  at: number;
  sessionKey?: string;
  sessionRef?: { provider: string; sessionId: string };
};

/** Everything the daemon knows about one pane. Status itself is derived. */
type PaneRecord = {
  paneId: number;
  sessionKey?: string;
  agent: AgentKind;
  authority: PaneAuthority;
  native?: NativeRecord;
  telemetry?: PaneTelemetry;
  /** Anti-flicker counters for the screen branch. Never persisted. */
  hysteresis: StatusHysteresis;
};

type PersistedState = {
  version: number;
  updatedAt: number;
  panes: {
    paneId: number;
    sessionKey?: string;
    agent: AgentKind;
    authority: PaneAuthority;
    native?: NativeRecord;
  }[];
};

export class AgentStatusState {
  private readonly records = new Map<number, PaneRecord>();
  private persistTimer: NodeJS.Timeout | null = null;

  constructor(private readonly paths: AgentStatusPaths) {}

  // ------------------------------------------------------------------ lifecycle

  /**
   * Restore the durable subset: pane identity plus native reports. Telemetry is
   * never persisted — it derives from a live PTY and may contain screen text.
   */
  async load(): Promise<void> {
    const stored = (await readStateFile(this.paths)) as PersistedState | null;
    if (!stored || stored.version !== STATE_FILE_VERSION || !Array.isArray(stored.panes)) return;
    for (const pane of stored.panes) {
      if (typeof pane?.paneId !== "number") continue;
      this.records.set(pane.paneId, {
        paneId: pane.paneId,
        sessionKey: pane.sessionKey,
        agent: pane.agent ?? "unknown",
        authority: pane.authority === "native" ? "native" : "screen",
        native: pane.native,
        hysteresis: createHysteresis()
      });
    }
  }

  // -------------------------------------------------------------------- inputs

  /** @returns true when the settled snapshot changed. */
  publishTelemetry(telemetry: PaneTelemetry): boolean {
    const now = Date.now();
    const existing = this.records.get(telemetry.paneId);
    const before = existing ? this.settle(existing, now) : undefined;
    const record: PaneRecord = existing ?? {
      paneId: telemetry.paneId,
      agent: "unknown",
      authority: "screen",
      hysteresis: createHysteresis()
    };
    record.telemetry = telemetry;
    if (telemetry.sessionKey) record.sessionKey = telemetry.sessionKey;
    // Identity comes from the sensor's process-tree probe; never let an
    // unresolved frame erase a name we already have.
    if (telemetry.agent && telemetry.agent !== "unknown") record.agent = telemetry.agent;
    // Hooks stay authoritative for their pane; telemetry only refreshes the
    // sensor-side evidence.
    if (record.authority !== "native") record.authority = "screen";
    // Exactly one hysteresis step per sensor frame, so reads never change verdicts.
    record.hysteresis = advanceHysteresis(record.hysteresis, screenHitFor(telemetry, now));
    return this.finish(record, before, now);
  }

  /**
   * Apply a hook report.
   *
   * @returns true when the settled snapshot changed. False covers every ignored
   *          case: sub-agent hook, stale sequence, unknown pane.
   */
  reportNative(report: NativeReport): boolean {
    if (report.subagent) return false;
    const existing = this.records.get(report.paneId);
    if (existing?.native && report.seq <= existing.native.seq) return false;
    const now = Date.now();
    const before = existing ? this.settle(existing, now) : undefined;
    const record: PaneRecord = existing ?? {
      paneId: report.paneId,
      agent: report.agent,
      authority: "native",
      hysteresis: createHysteresis()
    };
    record.native = {
      source: report.source,
      agent: report.agent,
      state: report.state,
      seq: report.seq,
      at: now,
      sessionKey: report.sessionKey,
      sessionRef: report.sessionRef
    };
    if (report.agent !== "unknown") record.agent = report.agent;
    record.authority = "native";
    // Screen evidence from before the hook existed must not resurface later.
    record.hysteresis = createHysteresis();
    if (report.sessionKey) record.sessionKey = report.sessionKey;
    return this.finish(record, before, now);
  }

  forget(paneId: number): boolean {
    const existed = this.records.delete(paneId);
    if (existed) this.schedulePersist();
    return existed;
  }

  // ------------------------------------------------------------------- readout

  snapshot(now = Date.now()): StatusSnapshot {
    const byPaneId: Record<string, PaneStatus> = {};
    const bySessionKey: Record<string, PaneStatus> = {};
    for (const record of this.records.values()) {
      const status = this.settle(record, now);
      byPaneId[String(record.paneId)] = status;
      if (record.sessionKey) bySessionKey[record.sessionKey] = status;
    }
    return {
      apiVersion: AGENT_STATUS_API_VERSION,
      generatedAt: now,
      byPaneId,
      bySessionKey
    };
  }

  explain(paneId: number, now = Date.now()): DetectionExplain | null {
    const record = this.records.get(paneId);
    if (!record) return null;
    const verdict = this.evaluate(record, now);
    return {
      paneId: record.paneId,
      sessionKey: record.sessionKey,
      agent: record.agent,
      state: verdict.state,
      authority: record.authority,
      source: verdict.source,
      reason:
        verdict.source === "native" && record.native
          ? `hook report from ${record.native.source}`
          : verdict.reason,
      updatedAt: now
    };
  }

  get paneCount(): number {
    return this.records.size;
  }

  async persist(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    const payload: PersistedState = {
      version: STATE_FILE_VERSION,
      updatedAt: Date.now(),
      panes: [...this.records.values()].map((record) => ({
        paneId: record.paneId,
        sessionKey: record.sessionKey,
        agent: record.agent,
        authority: record.authority,
        native: record.native
      }))
    };
    await writeStateFile(this.paths, payload);
  }

  // ----------------------------------------------------------------- internals

  /** Store the record, persist (debounced), and report whether status changed. */
  private finish(record: PaneRecord, before: PaneStatus | undefined, now: number): boolean {
    this.records.set(record.paneId, record);
    this.schedulePersist();
    const after = this.settle(record, now);
    return (
      before === undefined
      || before.state !== after.state
      || before.source !== after.source
      || before.authority !== after.authority
    );
  }

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persist().catch(() => undefined);
    }, PERSIST_DEBOUNCE_MS);
  }

  private evaluate(record: PaneRecord, now: number): Verdict {
    return evaluateStatus({
      nativeState: record.native?.state,
      telemetry: record.telemetry,
      hysteresis: record.hysteresis,
      screenHit: screenHitFor(record.telemetry, now),
      now
    });
  }

  private settle(record: PaneRecord, now: number): PaneStatus {
    const verdict = this.evaluate(record, now);
    return {
      paneId: record.paneId,
      sessionKey: record.sessionKey,
      agent: record.agent,
      state: verdict.state,
      authority: record.authority,
      source: verdict.source,
      updatedAt: now
    };
  }
}
