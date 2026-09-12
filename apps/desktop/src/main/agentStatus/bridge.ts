/**
 * Sensor → daemon bridge.
 *
 * The sensor produces frames continuously; the daemon may not be up yet, may be
 * restarting, or may have been replaced after an upgrade. Telemetry is periodic
 * and therefore droppable; hook reports are not, so they wait in a small queue.
 *
 * Electron-free.
 */

import { connectAgentStatusClient, type AgentStatusClient } from "./client";
import { agentStatusPaths } from "./paths";
import type { NativeReport, PaneTelemetry, StatusSnapshot } from "./types";

const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 10_000;
/** Bounded queue: a burst of hook reports must not grow without limit. */
const MAX_PENDING_REPORTS = 64;

export type AgentStatusBridge = {
  /** Start connecting (idempotent). */
  connect: () => void;
  /** Drop the current connection and connect again (panel home / daemon change). */
  reconnect: () => void;
  publishTelemetry: (telemetry: PaneTelemetry) => void;
  publishNativeReport: (report: NativeReport) => void;
  forgetPane: (paneId: number) => void;
  getSnapshot: () => StatusSnapshot | null;
  subscribe: (listener: (snapshot: StatusSnapshot) => void) => () => void;
  readonly connected: boolean;
  dispose: () => void;
};

export function createAgentStatusBridge(input: {
  /** Resolved on every connect, so a panel-home change just needs a reconnect. */
  getPanelHome: () => string;
  appVersion: string;
  log?: (message: string) => void;
}): AgentStatusBridge {
  const log = input.log ?? (() => undefined);
  const listeners = new Set<(snapshot: StatusSnapshot) => void>();
  const pendingReports: NativeReport[] = [];
  let client: AgentStatusClient | null = null;
  let connecting = false;
  let disposed = false;
  let retryTimer: NodeJS.Timeout | null = null;
  let retryDelay = RECONNECT_MIN_MS;
  let snapshot: StatusSnapshot | null = null;

  const notify = (next: StatusSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener(next);
  };

  const scheduleReconnect = () => {
    if (disposed || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, retryDelay);
    retryTimer.unref?.();
    retryDelay = Math.min(RECONNECT_MAX_MS, retryDelay * 2);
  };

  function connect(): void {
    if (disposed || client || connecting) return;
    connecting = true;
    void (async () => {
      try {
        const paths = agentStatusPaths(input.getPanelHome());
        const next = await connectAgentStatusClient({
          socketPath: paths.socket,
          role: "app",
          appVersion: input.appVersion
        });
        if (disposed) {
          next.close();
          return;
        }
        client = next;
        retryDelay = RECONNECT_MIN_MS;
        next.subscribe((event) => {
          if (event.event === "status.changed") notify(event.data);
          else if (event.event === "daemon.shutting_down") log("daemon is shutting down; will reconnect");
        });
        next.onClose(() => {
          if (client !== next) return;
          client = null;
          log("daemon connection closed; reconnecting");
          scheduleReconnect();
        });
        const initial = await next.request<StatusSnapshot>("status.snapshot");
        notify(initial);
        flushPending();
        log(`connected to agent-status daemon (api v${next.hello.apiVersion}, pid ${next.hello.pid})`);
      } catch {
        // The daemon may simply not be up yet.
        scheduleReconnect();
      } finally {
        connecting = false;
      }
    })();
  }

  function flushPending(): void {
    if (!client) return;
    const queued = pendingReports.splice(0, pendingReports.length);
    for (const report of queued) sendReport(report);
  }

  function sendReport(report: NativeReport): void {
    if (!client) {
      pendingReports.push(report);
      if (pendingReports.length > MAX_PENDING_REPORTS) pendingReports.shift();
      return;
    }
    void client.request("pane.report_state", report).catch(() => {
      pendingReports.push(report);
      if (pendingReports.length > MAX_PENDING_REPORTS) pendingReports.shift();
    });
  }

  return {
    connect,
    reconnect() {
      client?.close();
      client = null;
      retryDelay = RECONNECT_MIN_MS;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      connect();
    },
    publishTelemetry(telemetry) {
      if (!client) return;
      void client.request("telemetry.publish", telemetry).catch(() => undefined);
    },
    publishNativeReport(report) {
      sendReport(report);
    },
    forgetPane(paneId) {
      for (let index = pendingReports.length - 1; index >= 0; index -= 1) {
        if (pendingReports[index]?.paneId === paneId) pendingReports.splice(index, 1);
      }
      if (!client) return;
      void client.request("pane.forget", { paneId }).catch(() => undefined);
    },
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get connected() {
      return client !== null;
    },
    dispose() {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      client?.close();
      client = null;
      listeners.clear();
      pendingReports.length = 0;
    }
  };
}
