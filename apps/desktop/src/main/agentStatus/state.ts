/**
 * In-memory status state for the daemon: telemetry frames, native reports, the
 * settled snapshot, and its on-disk subset.
 *
 * This module owns the *bookkeeping* around a verdict — one rule evaluation and
 * one hysteresis step per sensor frame, sequence ordering, persistence, and the
 * snapshot shape subscribers see. The verdicts themselves come from
 * `engine/arbitrate.ts` (policy) over `engine/evaluate.ts` (rules).
 */

import type { AgentStatusPaths } from "./paths";
import { readStateFile, writeStateFile } from "./endpoint";
import {
  advanceHysteresis,
  arbitrateStatus,
  createHysteresis,
  type StatusHysteresis,
  type Verdict
} from "./engine/arbitrate";
import { evaluateRules, type ScreenVerdict } from "./engine/evaluate";
import type { ManifestRegistry } from "./engine/registry";
import type {
  AgentKind,
  AgentState,
  DetectionExplain,
  EvaluatedRule,
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

type ManifestRef = { id: string; version: string; source: "bundled" };

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
  /** Rule outcome for the current frame, recomputed on every telemetry frame. */
  screen: ScreenVerdict | null;
  evaluated: EvaluatedRule[];
  manifest?: ManifestRef;
  /** Last published state, so a viewer screen keeps showing it. */
  lastState?: AgentState;
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

  constructor(
    private readonly paths: AgentStatusPaths,
    private readonly manifests: ManifestRegistry
  ) {}

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
        hysteresis: createHysteresis(),
        screen: null,
        evaluated: [],
        lastState: pane.native?.state
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
      hysteresis: createHysteresis(),
      screen: null,
      evaluated: []
    };
    record.telemetry = telemetry;
    if (telemetry.sessionKey) record.sessionKey = telemetry.sessionKey;
    // Identity comes from the sensor's process-tree probe; never let an
    // unresolved frame erase a name we already have.
    if (telemetry.agent && telemetry.agent !== "unknown") record.agent = telemetry.agent;
    // Hooks stay authoritative for their pane; telemetry only refreshes the
    // sensor-side evidence.
    if (record.authority !== "native") record.authority = "screen";

    // Exactly one rule evaluation and one hysteresis step per sensor frame, so
    // reads never change verdicts.
    this.applyScreenFrame(record);
    record.hysteresis = advanceHysteresis(record.hysteresis, {
      blocked: record.screen?.state === "blocked" && !record.screen.skipStateUpdate,
      visibleIdle: record.screen?.visible.idle === true
    });
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
      hysteresis: createHysteresis(),
      screen: null,
      evaluated: []
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
    const fromScreen = verdict.source === "screen" || verdict.source === "osc";
    return {
      paneId: record.paneId,
      sessionKey: record.sessionKey,
      agent: record.agent,
      state: verdict.state,
      authority: record.authority,
      source: verdict.source,
      matchedRule: fromScreen ? record.screen?.matchedRule : undefined,
      reason:
        verdict.source === "native" && record.native
          ? `hook report from ${record.native.source}`
          : verdict.reason,
      manifest: record.manifest,
      screenSkipped: record.screen?.skipStateUpdate ? record.screen.reason : undefined,
      evaluated: record.evaluated,
      updatedAt: now
    };
  }

  /** Which rules are loaded, for diagnostics and the startup log. */
  manifestSummaries() {
    return this.manifests.summaries();
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
    record.lastState = after.state;
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

  /** Run the rules for this pane's agent against its current telemetry. */
  private applyScreenFrame(record: PaneRecord): void {
    const manifest = this.manifests.forAgent(record.agent);
    if (!manifest) {
      record.screen = null;
      record.evaluated = [];
      record.manifest = undefined;
      return;
    }
    const evaluation = evaluateRules(manifest, record.telemetry);
    record.screen = evaluation.verdict;
    record.evaluated = evaluation.evaluated;
    record.manifest = { id: manifest.id, version: manifest.version, source: "bundled" };
  }

  private evaluate(record: PaneRecord, now: number): Verdict {
    return arbitrateStatus({
      nativeState: record.native?.state,
      telemetry: record.telemetry,
      hysteresis: record.hysteresis,
      screen: record.screen,
      previousState: record.lastState,
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
      matchedRule:
        verdict.source === "screen" || verdict.source === "osc"
          ? record.screen?.matchedRule
          : undefined,
      updatedAt: now
    };
  }
}
