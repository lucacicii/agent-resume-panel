/**
 * App-side lifecycle for the agent-status daemon: resolve its entry script,
 * make sure a compatible instance is running, and install/remove the launchd
 * agent that keeps it alive across logins.
 *
 * Electron-free so it can be exercised by the daemon test script.
 */

import { execFile, spawn } from "node:child_process";
import { closeSync, existsSync, openSync } from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { connectAgentStatusClient } from "./client";
import {
  ensureAgentStatusDir,
  readLiveEndpoint,
  type AgentStatusEndpoint
} from "./endpoint";
import {
  AGENT_STATUS_APP_VERSION_ENV,
  AGENT_STATUS_LAUNCH_AGENT_LABEL,
  AGENT_STATUS_PANEL_HOME_ENV,
  agentStatusPaths,
  launchAgentPlistPath
} from "./paths";
import { AGENT_STATUS_API_VERSION } from "./types";

const execFileAsync = promisify(execFile);
const DEFAULT_START_TIMEOUT_MS = 5_000;
const START_POLL_MS = 50;

function resolveCoreRelativePath(relative: string, options: {
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
}): string {
  const candidates = options.isPackaged
    ? [
        path.join(options.resourcesPath, "app.asar.unpacked", relative),
        path.join(options.resourcesPath, "app.asar", relative),
        path.join(options.appPath, relative)
      ]
    : [path.join(options.appPath, relative)];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Unable to resolve ${relative}. Run the Desktop build first.`);
}

/** Compiled `agent-resume-status` CLI, invoked by installed hooks. */
export function resolveAgentStatusCliPath(options: {
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
}): string {
  return resolveCoreRelativePath(path.join("dist", "main", "agentStatus", "cli.js"), options);
}

/**
 * Locate the compiled daemon entry.
 *
 * Mirrors `mcpRegistration.resolveCoreMcpCliPath`: the packaged app already
 * launches asar-internal JavaScript under `ELECTRON_RUN_AS_NODE`, and an
 * unpacked copy is preferred when the packager produced one.
 */
export function resolveDaemonEntryPath(options: {
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
}): string {
  const relative = path.join("dist", "main", "agentStatus", "daemon.js");
  const candidates = options.isPackaged
    ? [
        path.join(options.resourcesPath, "app.asar.unpacked", relative),
        path.join(options.resourcesPath, "app.asar", relative),
        path.join(options.appPath, relative)
      ]
    : [path.join(options.appPath, relative)];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Unable to resolve the agent-status daemon entry (${relative}). Run the Desktop build first.`
  );
}

type EnsureDaemonResult = {
  started: boolean;
  endpoint: AgentStatusEndpoint;
};

/**
 * Ensure a compatible daemon owns the socket, starting or replacing it as
 * needed. Never throws for a merely slow daemon: callers log and continue.
 */
export async function ensureAgentStatusDaemon(input: {
  panelHome: string;
  execPath: string;
  entryPath: string;
  appVersion: string;
  /** Let the daemon post macOS notifications while no window is attached. */
  notify?: boolean;
  timeoutMs?: number;
  log?: (message: string) => void;
}): Promise<EnsureDaemonResult> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_START_TIMEOUT_MS;
  const log = input.log ?? (() => undefined);
  const paths = agentStatusPaths(input.panelHome);

  const existing = await readLiveEndpoint(paths);
  if (existing?.apiVersion === AGENT_STATUS_API_VERSION) {
    return { started: false, endpoint: existing };
  }
  const replace = Boolean(existing);

  await ensureAgentStatusDir(paths);
  const logFd = openSync(paths.log, "a", 0o600);
  const args = [
    input.entryPath,
    "--panel-home",
    input.panelHome,
    "--app-version",
    input.appVersion
  ];
  if (replace) args.push("--replace");
  if (input.notify) args.push("--notify");

  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(input.execPath, args, {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        [AGENT_STATUS_PANEL_HOME_ENV]: input.panelHome,
        [AGENT_STATUS_APP_VERSION_ENV]: input.appVersion
      }
    });
    child.unref();
  } finally {
    // The child holds its own descriptor; the app must not leak one per start.
    closeSync(logFd);
  }
  log(`spawned agent-status daemon pid ${child.pid ?? "unknown"}`);

  const endpoint = await waitForDaemon(input.panelHome, timeoutMs);
  if (!endpoint) {
    throw new Error(`agent-status daemon did not come up within ${timeoutMs}ms`);
  }
  return { started: true, endpoint };
}

/** Ask a running daemon to exit and remove its discovery handle. */
export async function stopAgentStatusDaemon(panelHome: string): Promise<void> {
  const paths = agentStatusPaths(panelHome);
  const existing = await readLiveEndpoint(paths);
  if (!existing) return;
  try {
    const client = await connectAgentStatusClient({
      socketPath: paths.socket,
      role: "app",
      connectTimeoutMs: 1_000
    });
    await client.request("daemon.shutdown", { reason: "app request" }, 1_000);
    client.close();
  } catch {
    // Fall through: a daemon that cannot answer is reported by the timeout.
  }
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if (!(await readLiveEndpoint(paths))) return;
    await delay(START_POLL_MS);
  }
}

export type AgentStatusDaemonStatus = {
  running: boolean;
  panelHome: string;
  socketPath: string;
  pid?: number;
  apiVersion?: number;
  appVersion?: string;
  startedAt?: number;
  subscriberCount?: number;
  paneCount?: number;
  manifests?: { id: string; version: string; engine: number; rules: number; source: string }[];
  launchAgentInstalled: boolean;
};

/**
 * Everything the settings pane shows about the background plane.
 *
 * Liveness comes from the endpoint file; the rest is asked of the daemon itself,
 * so the panel can never disagree with the process that is actually judging panes.
 */
export async function readAgentStatusDaemonStatus(panelHome: string): Promise<AgentStatusDaemonStatus> {
  const paths = agentStatusPaths(panelHome);
  const endpoint = await readLiveEndpoint(paths);
  const launchAgentInstalled = await isAgentStatusLaunchAgentInstalled().catch(() => false);
  const base: AgentStatusDaemonStatus = {
    running: Boolean(endpoint),
    panelHome,
    socketPath: paths.socket,
    launchAgentInstalled
  };
  if (!endpoint) return base;

  base.pid = endpoint.pid;
  base.apiVersion = endpoint.apiVersion;
  base.appVersion = endpoint.appVersion;
  base.startedAt = endpoint.startedAt;
  try {
    const client = await connectAgentStatusClient({
      socketPath: paths.socket,
      role: "app",
      connectTimeoutMs: 800
    });
    base.subscriberCount = client.hello.subscriberCount;
    base.paneCount = client.hello.paneCount;
    base.manifests = await client.request<AgentStatusDaemonStatus["manifests"]>("status.manifests");
    client.close();
  } catch {
    // The endpoint exists but the daemon is wedged: report what we know.
  }
  return base;
}

// --------------------------------------------------------------------------- launchd

/** True when the plist exists and launchd knows the service. */
export async function isAgentStatusLaunchAgentInstalled(): Promise<boolean> {
  const plistPath = launchAgentPlistPath();
  if (!existsSync(plistPath)) return false;
  try {
    await execFileAsync("launchctl", ["print", `${launchDomain()}/${AGENT_STATUS_LAUNCH_AGENT_LABEL}`]);
    return true;
  } catch {
    return false;
  }
}

function launchDomain(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  return `gui/${uid}`;
}

// ---------------------------------------------------------------------------- helpers

async function waitForDaemon(
  panelHome: string,
  timeoutMs: number
): Promise<AgentStatusEndpoint | null> {
  const paths = agentStatusPaths(panelHome);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const endpoint = await readLiveEndpoint(paths);
    if (endpoint) {
      // Confirm it actually answers before reporting success.
      try {
        const client = await connectAgentStatusClient({
          socketPath: paths.socket,
          role: "app",
          connectTimeoutMs: 500
        });
        client.close();
        return endpoint;
      } catch {
        // keep polling
      }
    }
    await delay(START_POLL_MS);
  }
  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


