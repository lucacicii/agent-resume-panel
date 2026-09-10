/**
 * Session status store.
 *
 * Owns every piece of session-status state: output timestamps, screen tails,
 * hysteresis, cursor visibility, ACP pending requests and the sampling loop.
 *
 * Deliberately framework-agnostic — it imports neither React nor Electron. The
 * UI subscribes to it through `sessionStatus/react.ts`. This is the only place
 * that knows how a status is obtained; the Workbench only feeds it events.
 */

import { parseReportedStatus, trackCursorVisibility } from "./protocol";
import { createHysteresis, probeSessionStatus, settleStatus } from "./resolver";
import type {
  ReportedStatus,
  SessionDotRuntime,
  SessionDotStatus,
  StatusHysteresis,
  SessionStatusSource
} from "./types";

/** Structural subset of an xterm terminal needed for screen sampling. */
export type StatusScreenReader = {
  rows: number;
  buffer: {
    active: {
      type: string;
      baseY: number;
      getLine(index: number): { translateToString(trimRight?: boolean): string } | undefined;
    };
  };
};

export type SessionStatusPane = {
  key: string;
  group: string;
  ptyId?: number | null;
  acpRecordId?: string;
};

/** Minimal shape of the ACP stream events this store cares about. */
export type AcpStatusEvent = {
  type?: string;
  chatId?: string;
  requestId?: string;
  status?: string;
  isRunning?: boolean;
  isConnecting?: boolean;
  init?: { status?: string; isRunning?: boolean; isConnecting?: boolean };
};

export type SessionStatusSnapshot = {
  /** Settled status per pane key. */
  runtimeByPaneKey: Record<string, SessionDotRuntime>;
  /** Which layer produced each verdict — surfaced for diagnosis. */
  sourceByPaneKey: Record<string, SessionStatusSource>;
};

const EMPTY_SNAPSHOT: SessionStatusSnapshot = { runtimeByPaneKey: {}, sourceByPaneKey: {} };

/** Silence before the screen is trusted again (avoids sampling mid-stream). */
const FINGERPRINT_QUIET_MS = 350;
/** Sampling cadence while the Workbench is visible / in the background. */
const FOREGROUND_INTERVAL_MS = 2_000;
const BACKGROUND_INTERVAL_MS = 4_000;
/** Rows of scrollback kept above the viewport when reading the screen. */
const SCREEN_HEADROOM_ROWS = 5;
/** Rolling PTY tail retained per pane while its terminal is unmounted. */
const TAIL_LIMIT_CHARS = 8_192;

type AcpFlags = { isRunning: boolean; isConnecting: boolean; status: string };

export function acpEventToStatus(input: {
  isRunning?: boolean;
  isConnecting?: boolean;
  status?: string;
  pendingRequestCount?: number;
}): SessionDotStatus {
  if ((input.pendingRequestCount ?? 0) > 0) return "awaiting_user";
  if (input.status === "error") return "error";
  if (input.isConnecting || input.status === "connecting") return "connecting";
  if (input.isRunning || input.status === "running" || input.status === "thinking") return "running";
  return "open";
}

export class SessionStatusStore {
  private panes: SessionStatusPane[] = [];
  private readonly readers = new Map<number, StatusScreenReader>();
  private readonly cursorHidden = new Map<number, boolean>();

  private readonly lastOutputAt = new Map<string, number>();
  private readonly tail = new Map<string, string>();
  private readonly hysteresis = new Map<string, StatusHysteresis>();
  private readonly reported = new Map<string, ReportedStatus>();

  private readonly acpFlags = new Map<string, AcpFlags>();
  private readonly acpPending = new Map<string, Set<string>>();

  private readonly listeners = new Set<() => void>();
  private snapshot: SessionStatusSnapshot = EMPTY_SNAPSHOT;

  private sampleTimer = 0;
  private tickTimer = 0;
  private foreground = true;
  private disposed = false;

  // ---------------------------------------------------------------- lifecycle

  dispose(): void {
    this.disposed = true;
    if (this.sampleTimer) {
      clearTimeout(this.sampleTimer);
      this.sampleTimer = 0;
    }
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = 0;
    }
    this.listeners.clear();
    this.readers.clear();
    this.cursorHidden.clear();
    this.lastOutputAt.clear();
    this.tail.clear();
    this.hysteresis.clear();
    this.reported.clear();
    this.acpFlags.clear();
    this.acpPending.clear();
    this.panes = [];
    this.snapshot = EMPTY_SNAPSHOT;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): SessionStatusSnapshot => this.snapshot;

  // ------------------------------------------------------------------- inputs

  /**
   * Replace the open-pane registry and drop state for panes that closed.
   *
   * Also guarantees the sampling loop is running: registering panes is the
   * statement of intent to track them, so a consumer can never end up with a
   * frozen snapshot just because it forgot a separate `start()` call.
   */
  setPanes(panes: readonly SessionStatusPane[]): void {
    if (!this.tickTimer && !this.disposed) this.restartTicking();
    const next = panes.filter((pane) => pane.group === "session");
    const open = new Set(next.map((pane) => pane.key));

    // Start the clock for a pane the first time we see it. Without this, an
    // unset timestamp reads as "just now" forever and a silent pane can never
    // decay to idle.
    const now = Date.now();
    for (const pane of next) {
      if (!this.lastOutputAt.has(pane.key)) this.lastOutputAt.set(pane.key, now);
    }

    for (const key of [...this.lastOutputAt.keys()]) {
      if (open.has(key)) continue;
      this.lastOutputAt.delete(key);
      this.tail.delete(key);
      this.hysteresis.delete(key);
      this.reported.delete(key);
    }

    const openAcp = new Set(next.map((pane) => pane.acpRecordId).filter((id): id is string => Boolean(id)));
    for (const chatId of [...this.acpFlags.keys()]) {
      if (openAcp.has(chatId)) continue;
      this.acpFlags.delete(chatId);
      this.acpPending.delete(chatId);
    }

    this.panes = next;
    this.publish();
  }

  attachTerminal(ptyId: number, reader: StatusScreenReader): void {
    this.readers.set(ptyId, reader);
  }

  detachTerminal(ptyId: number): void {
    this.readers.delete(ptyId);
    this.cursorHidden.delete(ptyId);
  }

  /** Raw PTY output. Feeds Tier 0 parsing and the activity clock. */
  ingestTerminalData(ptyId: number, chunk: string): void {
    if (!chunk) return;
    const pane = this.paneByPtyId(ptyId);
    if (!pane) {
      // Terminal is unmounted or belongs to a shell pane; still track cursor.
      trackCursorVisibility(chunk, this.cursorHidden, ptyId);
      return;
    }

    this.lastOutputAt.set(pane.key, Date.now());
    this.tail.set(pane.key, ((this.tail.get(pane.key) || "") + chunk).slice(-TAIL_LIMIT_CHARS));
    trackCursorVisibility(chunk, this.cursorHidden, ptyId);

    // An explicit status sequence is exact: apply it now instead of waiting
    // for the quiet window that screen sampling needs.
    if (this.absorbReport(pane.key, chunk)) {
      this.publish();
      return;
    }
    this.scheduleSample(FINGERPRINT_QUIET_MS);
  }

  /**
   * Throttled heartbeat from a background (unmounted) terminal.
   *
   * Applies immediately: the heartbeat already carries an exact timestamp, so
   * waiting for a quiet window would only make the indicator lag reality.
   */
  ingestTerminalActivity(ptyId: number, payload: { tail?: string; timestamp?: number }): void {
    const pane = this.paneByPtyId(ptyId);
    if (!pane) return;

    this.lastOutputAt.set(pane.key, payload.timestamp || Date.now());
    if (payload.tail) {
      this.tail.set(pane.key, payload.tail);
      this.absorbReport(pane.key, payload.tail);
    }
    this.publish();
  }

  ingestAcpEvent(event: AcpStatusEvent): void {
    const chatId = typeof event.chatId === "string" ? event.chatId : "";
    if (!chatId) return;

    switch (event.type) {
      case "status":
        this.acpFlags.set(chatId, {
          isRunning: Boolean(event.isRunning),
          isConnecting: Boolean(event.isConnecting),
          status: event.status || "ready"
        });
        break;
      case "init":
        if (!event.init) return;
        this.acpFlags.set(chatId, {
          isRunning: Boolean(event.init.isRunning),
          isConnecting: Boolean(event.init.isConnecting),
          status: event.init.status || "ready"
        });
        break;
      case "permissionRequest":
      case "userQuestion":
        if (event.requestId) this.acpPendingFor(chatId).add(event.requestId);
        break;
      case "permissionResolved":
      case "userQuestionResolved":
        if (event.requestId) this.acpPendingFor(chatId).delete(event.requestId);
        break;
      // ACP history replay cannot change live status; ignore the common case
      // instead of re-publishing on every streamed token.
      default:
        return;
    }

    this.publish();
  }

  /** The user typed into a session pane: treat it as active right now. */
  markUserInput(paneKey: string): void {
    const pane = this.panes.find((item) => item.key === paneKey);
    if (!pane) return;
    this.lastOutputAt.set(paneKey, Date.now());
    this.hysteresis.set(paneKey, createHysteresis());
    this.reported.delete(paneKey);
    this.publish();
  }

  /** Foreground drives the sampling cadence, not whether sampling happens. */
  setForeground(active: boolean): void {
    if (this.foreground === active) return;
    this.foreground = active;
    this.restartTicking();
  }

  start(): void {
    this.restartTicking();
    this.sample();
  }

  // ------------------------------------------------------------------ internals

  private paneByPtyId(ptyId: number): SessionStatusPane | undefined {
    return this.panes.find((pane) => pane.ptyId === ptyId);
  }

  private acpPendingFor(chatId: string): Set<string> {
    let set = this.acpPending.get(chatId);
    if (!set) {
      set = new Set();
      this.acpPending.set(chatId, set);
    }
    return set;
  }

  /** @returns true when the chunk carried an explicit status. */
  private absorbReport(paneKey: string, chunk: string): boolean {
    const report = parseReportedStatus(chunk);
    if (report) {
      this.reported.set(paneKey, report);
      return true;
    }
    // A stale "awaiting" claim must not outlive the agent moving on.
    if (this.reported.get(paneKey)?.status === "awaiting_user") {
      this.reported.delete(paneKey);
    }
    return false;
  }

  private scheduleSample(delayMs: number): void {
    if (this.disposed || this.sampleTimer) return;
    this.sampleTimer = window.setTimeout(() => {
      this.sampleTimer = 0;
      this.sample();
    }, delayMs);
  }

  private restartTicking(): void {
    if (this.tickTimer) {
      window.clearInterval(this.tickTimer);
      this.tickTimer = 0;
    }
    if (this.disposed) return;
    const interval = this.foreground ? FOREGROUND_INTERVAL_MS : BACKGROUND_INTERVAL_MS;
    this.tickTimer = window.setInterval(() => this.sample(), interval);
  }

  /**
   * Read every open pane once and republish if anything settled differently.
   * Runs on a timer as well as after output, so idle decay still advances.
   */
  private sample(): void {
    if (this.disposed) return;
    const now = Date.now();
    const runtime: Record<string, SessionDotRuntime> = {};
    const source: Record<string, SessionStatusSource> = {};
    let changed = false;

    for (const pane of this.panes) {
      const outcome = this.probePane(pane, now);
      runtime[pane.key] = {
        status: outcome.status,
        awaitingConfidence: outcome.awaitingConfidence
      };
      source[pane.key] = outcome.source;

      const previous = this.snapshot.runtimeByPaneKey[pane.key];
      if (
        previous?.status !== outcome.status
        || previous?.awaitingConfidence !== outcome.awaitingConfidence
        || this.snapshot.sourceByPaneKey[pane.key] !== outcome.source
      ) {
        changed = true;
      }
    }

    const countChanged = Object.keys(this.snapshot.runtimeByPaneKey).length !== Object.keys(runtime).length;
    if (!changed && !countChanged) return;

    this.snapshot = { runtimeByPaneKey: runtime, sourceByPaneKey: source };
    this.emit();
  }

  private probePane(pane: SessionStatusPane, now: number): SessionDotRuntime & { source: SessionStatusSource } {
    if (pane.acpRecordId) {
      const flags = this.acpFlags.get(pane.acpRecordId) || { isRunning: false, isConnecting: false, status: "ready" };
      const pendingRequestCount = this.acpPending.get(pane.acpRecordId)?.size ?? 0;
      const status = acpEventToStatus({ ...flags, pendingRequestCount });
      return {
        status,
        awaitingConfidence: status === "awaiting_user" ? "confirmed" : undefined,
        source: "native"
      };
    }

    const lastOutputAt = this.lastOutputAt.get(pane.key);
    const reader = pane.ptyId != null ? this.readers.get(pane.ptyId) : undefined;
    const probe = probeSessionStatus({
      visibleText: reader ? this.readScreen(reader) : (this.tail.get(pane.key) || ""),
      // A pane with no recorded output has been silent since it was registered.
      lastOutputAt: lastOutputAt ?? now,
      now,
      cursorHidden: pane.ptyId != null ? (this.cursorHidden.get(pane.ptyId) ?? false) : false,
      reported: this.reported.get(pane.key) ?? null
    });

    const settled = settleStatus(this.hysteresis.get(pane.key) ?? createHysteresis(), probe);
    this.hysteresis.set(pane.key, settled.state);
    return { status: settled.status, awaitingConfidence: settled.awaitingConfidence, source: probe.source };
  }

  /**
   * Read the whole visible screen plus a little scrollback.
   *
   * Full height is mandatory: full-screen TUIs paint from row 0, so reading
   * "the bottom N rows" silently drops the menu on tall terminals.
   */
  private readScreen(reader: StatusScreenReader): string {
    const buffer = reader.buffer.active;
    const start = Math.max(0, buffer.baseY - SCREEN_HEADROOM_ROWS);
    const count = reader.rows + (buffer.baseY - start);
    const lines: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const line = buffer.getLine(start + index);
      if (line) lines.push(line.translateToString(true));
    }
    return lines.join("\n");
  }

  private publish(): void {
    if (this.disposed) return;
    this.sample();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
