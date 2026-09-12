/**
 * agent-status daemon entry point.
 *
 * Runs as a plain Node process under `ELECTRON_RUN_AS_NODE=1` (or as `node`
 * during tests), started at login by launchd and kept alive by the app. It owns
 * the status snapshot so state survives the Electron window closing, and it is
 * the single place where hook reports land.
 *
 * Electron-free by construction: this file must never import `electron`.
 */

import { resolvePanelHome } from "@agent-resume/core";
import { connectAgentStatusClient } from "./client";
import {
  ensureAgentStatusDir,
  readLiveEndpoint,
  removeFile,
  writeEndpointFile,
  type AgentStatusEndpoint
} from "./endpoint";
import {
  AGENT_STATUS_APP_VERSION_ENV,
  AGENT_STATUS_PANEL_HOME_ENV,
  AGENT_STATUS_SOCKET_MAX_BYTES,
  agentStatusPaths,
  type AgentStatusPaths
} from "./paths";
import { startAgentStatusServer, type AgentStatusServer, type RequestContext } from "./server";
import { AgentStatusState } from "./state";
import {
  AGENT_STATUS_API_VERSION,
  type AgentState,
  type AgentKind,
  type DetectionExplain,
  type HelloResult,
  type NativeReport,
  type PaneTelemetry,
  type StatusSnapshot
} from "./types";

const LOG_PREFIX = "[agent-status]";
const ENDPOINT_HEARTBEAT_MS = 30_000;

export type AgentStatusDaemonHandle = {
  readonly endpoint: AgentStatusEndpoint;
  readonly state: AgentStatusState;
  stop: (reason: string) => Promise<void>;
};

export type StartDaemonOptions = {
  panelHome: string;
  appVersion?: string;
  /** Replace a live daemon instead of exiting (used by the app after an upgrade). */
  replace?: boolean;
  log?: (message: string) => void;
};

/**
 * Start the daemon.
 *
 * @returns the running handle, or null when a compatible daemon already owns
 *          the socket (single instance by construction).
 */
export async function startAgentStatusDaemon(
  options: StartDaemonOptions
): Promise<AgentStatusDaemonHandle | null> {
  const log = options.log ?? ((message: string) => console.log(`${LOG_PREFIX} ${message}`));
  const paths = agentStatusPaths(options.panelHome);
  const appVersion = options.appVersion ?? "unknown";

  const existing = await readLiveEndpoint(paths);
  if (existing) {
    if (!options.replace) {
      log(`daemon already running (pid ${existing.pid}, api v${existing.apiVersion}); exiting`);
      return null;
    }
    log(`replacing daemon pid ${existing.pid}`);
    await requestShutdown(paths.socket);
    await waitForSocketRelease(paths, 2_000);
  }

  await ensureAgentStatusDir(paths);
  if (Buffer.byteLength(paths.socket) >= AGENT_STATUS_SOCKET_MAX_BYTES) {
    throw new Error(
      `agent-status socket path is too long for this platform (${Buffer.byteLength(paths.socket)} bytes): ${paths.socket}`
    );
  }
  const state = new AgentStatusState(paths);
  await state.load();

  const startedAt = Date.now();
  let stopping = false;
  let heartbeat: NodeJS.Timeout | null = null;
  const endpoint: AgentStatusEndpoint = {
    apiVersion: AGENT_STATUS_API_VERSION,
    appVersion,
    pid: process.pid,
    socketPath: paths.socket,
    startedAt,
    updatedAt: startedAt
  };

  const broadcastSnapshot = (): void => {
    server.broadcast({ event: "status.changed", data: state.snapshot() });
  };

  const server: AgentStatusServer = await startAgentStatusServer({
    socketPath: paths.socket,
    log: (message) => log(message),
    onError: (error, where) => log(`socket ${where} error: ${describe(error)}`),
    handle: (method, params, context) =>
      handleRequest(method, params, context, { state, endpoint, server: () => server, broadcastSnapshot, log, stop: (reason) => stop(reason) })
  });

  await writeEndpointFile(paths, endpoint);
  log(`listening on ${paths.socket} (api v${AGENT_STATUS_API_VERSION}, pid ${process.pid})`);

  heartbeat = setInterval(() => {
    endpoint.updatedAt = Date.now();
    void writeEndpointFile(paths, endpoint).catch(() => undefined);
  }, ENDPOINT_HEARTBEAT_MS);
  heartbeat.unref();

  const stop = async (reason: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    log(`stopping: ${reason}`);
    if (heartbeat) clearInterval(heartbeat);
    server.broadcast({ event: "daemon.shutting_down", data: { reason, at: Date.now() } });
    await server.close();
    await state.persist().catch(() => undefined);
    await removeFile(paths.endpoint);
  };

  return { endpoint, state, stop };
}

// ------------------------------------------------------------------- request handling

type DaemonInternals = {
  state: AgentStatusState;
  endpoint: AgentStatusEndpoint;
  server: () => AgentStatusServer;
  broadcastSnapshot: () => void;
  stop: (reason: string) => Promise<void>;
  log: (message: string) => void;
};

async function handleRequest(
  method: string,
  params: unknown,
  context: RequestContext,
  internals: DaemonInternals
): Promise<unknown> {
  switch (method) {
    case "hello": {
      const hello: HelloResult = {
        apiVersion: AGENT_STATUS_API_VERSION,
        appVersion: internals.endpoint.appVersion,
        pid: internals.endpoint.pid,
        startedAt: internals.endpoint.startedAt,
        paneCount: internals.state.paneCount,
        subscriberCount: internals.server().subscriberCount
      };
      return hello;
    }
    case "telemetry.publish": {
      const telemetry = asTelemetry(params);
      if (!telemetry) throw badRequest("Invalid telemetry frame.");
      if (internals.state.publishTelemetry(telemetry)) internals.broadcastSnapshot();
      return null;
    }
    case "pane.report_state": {
      const report = asNativeReport(params);
      if (!report) throw badRequest("Invalid native report.");
      const applied = internals.state.reportNative(report);
      if (!applied) internals.log(`ignored report from ${report.source} (stale or sub-agent)`);
      else internals.broadcastSnapshot();
      return { applied };
    }
    case "pane.forget": {
      const paneId = asPaneId((params as { paneId?: unknown })?.paneId);
      if (paneId == null) throw badRequest("Invalid paneId.");
      if (internals.state.forget(paneId)) internals.broadcastSnapshot();
      return { forgotten: true };
    }
    case "status.snapshot": {
      const snapshot: StatusSnapshot = internals.state.snapshot();
      return snapshot;
    }
    case "status.explain": {
      const paneId = asPaneId((params as { paneId?: unknown })?.paneId);
      if (paneId == null) throw badRequest("Invalid paneId.");
      const explain: DetectionExplain | null = internals.state.explain(paneId);
      return explain;
    }
    case "status.subscribe": {
      context.subscribe();
      return { subscribed: true };
    }
    case "daemon.shutdown": {
      const reason = typeof (params as { reason?: unknown })?.reason === "string"
        ? String((params as { reason: string }).reason)
        : "requested";
      // Answer first, then stop, so the caller sees a clean response.
      setTimeout(() => void internals.stop(`shutdown request: ${reason}`), 20).unref();
      return { stopping: true };
    }
    default:
      throw Object.assign(new Error(`Unknown method: ${method}`), { code: "unknown_method" });
  }
}

function badRequest(message: string): Error {
  return Object.assign(new Error(message), { code: "bad_request" });
}

function asPaneId(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

const AGENT_KINDS: readonly AgentKind[] = ["claude", "codex", "pi", "opencode", "unknown"];
const AGENT_STATES: readonly AgentState[] = ["idle", "working", "blocked", "unknown"];

function asAgentKind(value: unknown): AgentKind | null {
  return typeof value === "string" && (AGENT_KINDS as readonly string[]).includes(value)
    ? (value as AgentKind)
    : null;
}

function asAgentState(value: unknown): AgentState | null {
  return typeof value === "string" && (AGENT_STATES as readonly string[]).includes(value)
    ? (value as AgentState)
    : null;
}

/** Socket input is untrusted: shape it explicitly instead of casting. */
function asTelemetry(params: unknown): PaneTelemetry | null {
  if (!params || typeof params !== "object") return null;
  const record = params as Record<string, unknown>;
  const paneId = asPaneId(record.paneId);
  if (paneId == null) return null;
  const telemetry: PaneTelemetry = {
    paneId,
    at: typeof record.at === "number" && Number.isFinite(record.at) ? record.at : Date.now()
  };
  if (typeof record.ptyPid === "number") telemetry.ptyPid = record.ptyPid;
  if (typeof record.cwd === "string") telemetry.cwd = record.cwd;
  if (typeof record.sessionKey === "string") telemetry.sessionKey = record.sessionKey;
  if (typeof record.screenText === "string") telemetry.screenText = record.screenText;
  if (typeof record.oscTitle === "string") telemetry.oscTitle = record.oscTitle;
  if (typeof record.oscProgress === "string") telemetry.oscProgress = record.oscProgress;
  if (typeof record.cursorHidden === "boolean") telemetry.cursorHidden = record.cursorHidden;
  if (typeof record.toolRunning === "boolean") telemetry.toolRunning = record.toolRunning;
  if (Array.isArray(record.foregroundProcesses)) {
    telemetry.foregroundProcesses = record.foregroundProcesses
      .filter((item): item is string => typeof item === "string")
      .slice(0, 32);
  }
  if (typeof record.lastOutputAt === "number" && Number.isFinite(record.lastOutputAt)) {
    telemetry.lastOutputAt = record.lastOutputAt;
  }
  return telemetry;
}

function asNativeReport(params: unknown): NativeReport | null {
  if (!params || typeof params !== "object") return null;
  const record = params as Record<string, unknown>;
  const paneId = asPaneId(record.paneId);
  const agent = asAgentKind(record.agent);
  const state = asAgentState(record.state);
  const source = typeof record.source === "string" ? record.source.trim().slice(0, 120) : "";
  const seq = typeof record.seq === "number" && Number.isFinite(record.seq) ? record.seq : null;
  if (paneId == null || !agent || !state || !source || seq == null) return null;
  const report: NativeReport = { paneId, source, agent, state, seq };
  if (typeof record.sessionKey === "string") report.sessionKey = record.sessionKey;
  if (record.subagent === true) report.subagent = true;
  const sessionRef = record.sessionRef as { provider?: unknown; sessionId?: unknown } | undefined;
  if (sessionRef && typeof sessionRef.provider === "string" && typeof sessionRef.sessionId === "string") {
    report.sessionRef = { provider: sessionRef.provider, sessionId: sessionRef.sessionId };
  }
  return report;
}

// --------------------------------------------------------------------- client helpers

async function requestShutdown(socketPath: string): Promise<void> {
  try {
    const client = await connectAgentStatusClient({ socketPath, role: "cli", connectTimeoutMs: 1_000 });
    await client.request("daemon.shutdown", { reason: "replace" }, 1_000);
    client.close();
  } catch {
    // A daemon that cannot be asked politely is handled by the timeout below.
  }
}

async function waitForSocketRelease(paths: AgentStatusPaths, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await readLiveEndpoint(paths))) return;
    await delay(50);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ------------------------------------------------------------------------------ entry

export type DaemonArgs = {
  panelHome: string;
  appVersion: string;
  replace: boolean;
};

export function parseDaemonArgs(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): DaemonArgs {
  let panelHome = env[AGENT_STATUS_PANEL_HOME_ENV]?.trim() ?? "";
  let appVersion = env[AGENT_STATUS_APP_VERSION_ENV]?.trim() ?? "";
  let replace = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    const [flag, inline] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, undefined];
    const next = inline ?? argv[index + 1] ?? "";
    if (flag === "--panel-home") {
      panelHome = next;
      if (inline === undefined) index += 1;
    } else if (flag === "--app-version") {
      appVersion = next;
      if (inline === undefined) index += 1;
    } else if (flag === "--replace") {
      replace = true;
    }
  }
  return {
    panelHome: resolvePanelHome(panelHome),
    appVersion: appVersion || "unknown",
    replace
  };
}

/**
 * Run the daemon until it is asked to stop.
 *
 * @returns the process exit code.
 */
export async function runAgentStatusDaemon(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  const args = parseDaemonArgs(argv, env);
  const log = (message: string) => console.log(`${LOG_PREFIX} ${message}`);

  let handle: AgentStatusDaemonHandle | null;
  try {
    handle = await startAgentStatusDaemon({
      panelHome: args.panelHome,
      appVersion: args.appVersion,
      replace: args.replace,
      log
    });
  } catch (error) {
    log(`failed to start: ${describe(error)}`);
    return 1;
  }
  if (!handle) return 0;

  const running = handle;
  const shutdown = (signal: string) => {
    void running.stop(`signal ${signal}`).then(() => {
      process.exitCode = 0;
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  // A daemon that dies loses the whole snapshot, so log and keep serving.
  process.on("uncaughtException", (error) => log(`uncaught exception: ${describe(error)}`));
  process.on("unhandledRejection", (error) => log(`unhandled rejection: ${describe(error)}`));
  return 0;
}

if (require.main === module) {
  // Keep the process alive until stop(); the listening socket does that for us.
  void runAgentStatusDaemon().then((code) => {
    if (code !== 0) process.exitCode = code;
  });
}
