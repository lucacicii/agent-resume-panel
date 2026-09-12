/**
 * agent-status daemon lifecycle + protocol test.
 *
 * Runs against the compiled daemon (`dist/main/agentStatus/daemon.js`), so
 * `pnpm run build:desktop` must have run first — same convention as the other
 * script-level desktop tests.
 *
 * Covers what stage 1 promises: single instance, unix socket permissions,
 * handshake/version, telemetry → snapshot, hook report ordering, subscriber
 * pushes, persistence across restarts, and clean shutdown.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const daemonEntry = path.join(here, "..", "dist", "main", "agentStatus", "daemon.js");
const {
  readEndpointFile,
  readLiveEndpoint
} = await import(path.join(here, "..", "dist", "main", "agentStatus", "endpoint.js"));
const { connectAgentStatusClient } = await import(
  path.join(here, "..", "dist", "main", "agentStatus", "client.js")
);
const { agentStatusPaths } = await import(path.join(here, "..", "dist", "main", "agentStatus", "paths.js"));
const { parseDaemonArgs } = await import(path.join(here, "..", "dist", "main", "agentStatus", "daemon.js"));
const { RUNNING_WINDOW_MS } = await import(
  path.join(here, "..", "dist", "main", "agentStatus", "derive.js")
);
const { buildLaunchAgentPlist } = await import(
  path.join(here, "..", "dist", "main", "agentStatus", "lifecycle.js")
);
const { ensureAgentStatusDaemon, stopAgentStatusDaemon } = await import(
  path.join(here, "..", "dist", "main", "agentStatus", "lifecycle.js")
);

if (!fs.existsSync(daemonEntry)) {
  throw new Error(
    `Missing ${daemonEntry}. Run "pnpm --filter @agent-resume/desktop run build" (or pnpm run build:desktop) before this test.`
  );
}

const APP_VERSION = "0.0.0-test";
const panelHome = fs.mkdtempSync(path.join(os.tmpdir(), "agent-resume-status-"));
const paths = agentStatusPaths(panelHome);
const children = new Set();
const daemons = [];
const detachedPids = new Set();

function startDaemon(extraArgs = []) {
  const child = spawn(process.execPath, [daemonEntry, "--panel-home", panelHome, "--app-version", APP_VERSION, ...extraArgs], {
    env: { ...process.env, AGENT_RESUME_PANEL_HOME: panelHome, AGENT_RESUME_APP_VERSION: APP_VERSION },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const logs = [];
  child.stdout.on("data", (chunk) => {
    logs.push(String(chunk));
    if (process.env.AGENT_STATUS_TEST_VERBOSE === "1") process.stdout.write(`[daemon ${child.pid}] ${chunk}`);
  });
  child.stderr.on("data", (chunk) => {
    logs.push(String(chunk));
    if (process.env.AGENT_STATUS_TEST_VERBOSE === "1") process.stderr.write(`[daemon ${child.pid}] ${chunk}`);
  });
  children.add(child);
  child.on("exit", () => children.delete(child));
  const daemon = { child, logs };
  daemons.push(daemon);
  return daemon;
}

function daemonExited(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve) => child.once("exit", (code) => resolve(code)));
}

async function waitFor(predicate, description, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${description}`);
}
async function connect(role = "test") {
  return connectAgentStatusClient({ socketPath: paths.socket, role, appVersion: APP_VERSION });
}

function mode(target) {
  return fs.statSync(target).mode & 0o777;
}

async function main() {
  // ---------------------------------------------------------------- arg parsing
  const parsed = parseDaemonArgs(["--panel-home=/tmp/x", "--app-version", "1.2.3", "--replace"], {});
  assert.equal(parsed.appVersion, "1.2.3");
  assert.equal(parsed.replace, true);
  assert.ok(parsed.panelHome.endsWith("/tmp/x"));
  const fromEnv = parseDaemonArgs([], { AGENT_RESUME_PANEL_HOME: panelHome, AGENT_RESUME_APP_VERSION: "9" });
  assert.equal(fromEnv.panelHome, panelHome);
  assert.equal(fromEnv.appVersion, "9");
  assert.equal(fromEnv.replace, false);
  console.log("ok 1 - daemon args: flag, env, and default sources");

  // ------------------------------------------------------------ launchd plist
  const plist = buildLaunchAgentPlist({
    execPath: "/Applications/Agent & Resume.app/Contents/MacOS/Agent Resume",
    entryPath: "/Applications/Agent Resume.app/Contents/Resources/app.asar/dist/main/agentStatus/daemon.js",
    panelHome,
    logPath: paths.log
  });
  assert.match(plist, /<key>Label<\/key>\n\s*<string>dev\.agentresume\.agent-status<\/string>/);
  assert.match(plist, /<key>RunAtLoad<\/key>\n\s*<true\/>/);
  assert.match(plist, /<key>SuccessfulExit<\/key>\n\s*<false\/>/);
  assert.match(plist, /Agent &amp; Resume/);
  assert.match(plist, /<key>ELECTRON_RUN_AS_NODE<\/key>/);
  console.log("ok 2 - launchd plist: label, keep-alive policy, XML escaping");

  // ------------------------------------------------------------- daemon startup
  const first = startDaemon();
  const endpoint = await waitFor(() => readLiveEndpoint(paths), "the daemon endpoint");
  assert.equal(endpoint.apiVersion, 1);
  assert.equal(endpoint.appVersion, APP_VERSION);
  assert.equal(mode(paths.dir), 0o700, "panel-home daemon dir must be 0700");
  assert.equal(mode(paths.socket), 0o600, "unix socket must be 0600");
  assert.ok(
    Buffer.byteLength(paths.socket) < 100,
    `unix socket paths are capped at ~104 bytes, got ${Buffer.byteLength(paths.socket)}`
  );
  assert.ok(paths.socket.startsWith(os.tmpdir()), "the socket must live in the short per-user temp dir");
  assert.ok(paths.endpoint.startsWith(paths.dir), "the discovery handle must live under the panel home");
  assert.equal(mode(paths.endpoint), 0o600, "endpoint file must be 0600");
  console.log("ok 3 - startup: endpoint published, dir 0700, socket/endpoint 0600");

  // ------------------------------------------------------------------ handshake
  const client = await connect("app");
  assert.equal(client.hello.apiVersion, 1);
  assert.equal(client.hello.appVersion, APP_VERSION);
  assert.equal(client.hello.paneCount, 0);
  assert.equal(client.hello.subscriberCount, 0);
  console.log("ok 4 - handshake: api version and empty pane count");

  // ------------------------------------------------------- single instance guard
  const second = startDaemon();
  assert.equal(await daemonExited(second.child), 0);
  assert.match(second.logs.join(""), /already running/);
  assert.ok(await readLiveEndpoint(paths), "the first daemon must keep the socket");
  console.log("ok 5 - single instance: second daemon exits 0 and leaves the socket alone");

  // --------------------------------------------------- telemetry → derived state
  const now = Date.now();
  await client.request("telemetry.publish", {
    paneId: 1,
    ptyPid: process.pid,
    cwd: "/tmp/project",
    sessionKey: "cli:abc",
    screenText: "❯ ",
    lastOutputAt: now,
    at: now
  });
  let snapshot = await client.request("status.snapshot");
  assert.equal(snapshot.byPaneId["1"].state, "working");
  assert.equal(snapshot.byPaneId["1"].source, "activity");
  assert.equal(snapshot.bySessionKey["cli:abc"].paneId, 1);
  console.log("ok 6 - telemetry: fresh output settles to working/activity");

  await client.request("telemetry.publish", { paneId: 1, lastOutputAt: now, toolRunning: true, at: now });
  snapshot = await client.request("status.snapshot");
  assert.equal(snapshot.byPaneId["1"].source, "process");
  console.log("ok 7 - telemetry: a running tool outranks raw activity");

  await client.request("telemetry.publish", {
    paneId: 1,
    lastOutputAt: now - RUNNING_WINDOW_MS - 1_000,
    toolRunning: false,
    at: now
  });
  snapshot = await client.request("status.snapshot");
  assert.equal(snapshot.byPaneId["1"].state, "idle");
  assert.equal(snapshot.byPaneId["1"].source, "fallback");
  console.log("ok 8 - telemetry: stale silence reports idle instead of inventing a state");

  // ------------------------------------------------------------------- identity
  await client.request("telemetry.publish", {
    paneId: 1,
    agent: "claude",
    agentProcess: "/Users/someone/.local/bin/claude",
    lastOutputAt: now,
    at: now
  });
  snapshot = await client.request("status.snapshot");
  assert.equal(snapshot.byPaneId["1"].agent, "claude");
  const unidentified = await client.request("telemetry.publish", {
    paneId: 1,
    agent: "unknown",
    lastOutputAt: now,
    at: now
  });
  assert.equal(unidentified, null);
  snapshot = await client.request("status.snapshot");
  assert.equal(snapshot.byPaneId["1"].agent, "claude", "an unresolved frame must not erase a known agent");
  console.log("ok 9 - identity: the sensor names the agent and unknown never erases it");

  // --------------------------------------------------------- native report order
  const applied = await client.request("pane.report_state", {
    paneId: 1,
    source: "agent-resume:claude",
    agent: "claude",
    state: "blocked",
    seq: 5,
    sessionKey: "cli:abc"
  });
  assert.deepEqual(applied, { applied: true });
  snapshot = await client.request("status.snapshot");
  assert.equal(snapshot.byPaneId["1"].state, "blocked");
  assert.equal(snapshot.byPaneId["1"].authority, "native");

  const stale = await client.request("pane.report_state", {
    paneId: 1,
    source: "agent-resume:claude",
    agent: "claude",
    state: "idle",
    seq: 4
  });
  assert.deepEqual(stale, { applied: false });
  snapshot = await client.request("status.snapshot");
  assert.equal(snapshot.byPaneId["1"].state, "blocked", "an out-of-order report must not win");

  const subagent = await client.request("pane.report_state", {
    paneId: 1,
    source: "agent-resume:claude",
    agent: "claude",
    state: "idle",
    seq: 6,
    subagent: true
  });
  assert.deepEqual(subagent, { applied: false });
  snapshot = await client.request("status.snapshot");
  assert.equal(snapshot.byPaneId["1"].state, "blocked", "sub-agent hooks must not own the pane");
  console.log("ok 10 - native reports: applied, stale dropped, sub-agent dropped");

  // ------------------------------------------------------------- explain readout
  const explain = await client.request("status.explain", { paneId: 1 });
  assert.equal(explain.authority, "native");
  assert.equal(explain.agent, "claude");
  assert.match(explain.reason, /agent-resume:claude/);
  assert.equal(await client.request("status.explain", { paneId: 999 }), null);
  console.log("ok 11 - explain: authority, source, and reason for a pane");

  // ----------------------------------------------------------------- subscription
  const received = [];
  const unsubscribe = client.subscribe((event) => received.push(event));
  // The subscribe request is fire-and-forget on the client side; give the
  // server a moment to flag the connection before publishing.
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(received.length, 0, "subscribing alone must not emit an event");
  await client.request("telemetry.publish", { paneId: 2, lastOutputAt: Date.now(), at: Date.now() });
  await waitFor(() => received.length > 0, "a status.changed push");
  assert.equal(received[0].event, "status.changed");
  assert.equal(received[0].data.byPaneId["2"].state, "working");
  unsubscribe();
  console.log("ok 12 - subscription: status.changed pushed only on real change");

  // ------------------------------------------------------------- protocol errors
  await assert.rejects(
    () => client.request("nope.method"),
    (error) => error.code === "unknown_method"
  );
  await assert.rejects(
    () => client.request("telemetry.publish", { paneId: "not-a-number" }),
    (error) => error.code === "bad_request"
  );
  assert.ok(await client.request("status.snapshot"), "the daemon must survive bad input");
  console.log("ok 13 - protocol: unknown method and malformed payload degrade to errors, daemon stays up");

  // --------------------------------------------------------------- persistence
  await client.request("pane.forget", { paneId: 2 });
  client.close();
  first.child.kill("SIGTERM");
  assert.equal(await daemonExited(first.child), 0);
  assert.equal(await readLiveEndpoint(paths), null, "endpoint must be gone after shutdown");
  assert.equal(fs.existsSync(paths.socket), false, "socket file must be unlinked after shutdown");
  const persisted = JSON.parse(fs.readFileSync(paths.state, "utf8"));
  assert.equal(persisted.version, 1);
  assert.equal(persisted.panes.length, 1, "forgotten panes must not be persisted");
  assert.equal(persisted.panes[0].native.state, "blocked");
  assert.equal(JSON.stringify(persisted).includes("screenText"), false, "screen text must never be persisted");
  console.log("ok 14 - shutdown: socket unlinked, endpoint removed, durable state kept without screen text");

  const restarted = startDaemon();
  await waitFor(() => readLiveEndpoint(paths), "the restarted daemon");
  const restored = await waitFor(async () => {
    try {
      const restartedClient = await connect();
      const restoredSnapshot = await restartedClient.request("status.snapshot");
      restartedClient.close();
      return restoredSnapshot;
    } catch {
      return null;
    }
  }, "the restored snapshot");
  assert.equal(restored.byPaneId["1"].state, "blocked");
  assert.equal(restored.byPaneId["1"].authority, "native");
  assert.equal(restored.byPaneId["2"], undefined, "forgotten panes must stay forgotten");
  console.log("ok 15 - restart: native reports are restored from state.json");

  // ---------------------------------------------------------- replace + shutdown
  const replacement = startDaemon(["--replace"]);
  await waitFor(() => {
    const code = replacement.child.exitCode;
    return code === null && fs.existsSync(paths.socket);
  }, "the replacement daemon to take over");
  await waitFor(async () => {
    const live = await readLiveEndpoint(paths);
    return live?.pid === replacement.child.pid;
  }, "the endpoint to point at the replacement");
  assert.equal(await daemonExited(restarted.child), 0, "the replaced daemon must exit cleanly");

  const shutdownClient = await connect();
  const liveEndpoint = await readLiveEndpoint(paths);
  assert.equal(liveEndpoint.pid, replacement.child.pid);
  await shutdownClient.request("daemon.shutdown", { reason: "test" });
  shutdownClient.close();
  assert.equal(await daemonExited(replacement.child), 0);
  assert.equal(await readEndpointFile(paths), null);
  assert.equal(fs.existsSync(paths.socket), false);
  console.log("ok 16 - replace and shutdown request: clean handover, no stale socket");

  // -------------------------------------------------- app-side ensure / stop
  const ensured = await ensureAgentStatusDaemon({
    panelHome,
    execPath: process.execPath,
    entryPath: daemonEntry,
    appVersion: APP_VERSION,
    timeoutMs: 5_000
  });
  detachedPids.add(ensured.endpoint.pid);
  assert.equal(ensured.started, true, "the app must start a daemon when none is running");
  assert.ok(await readLiveEndpoint(paths));

  const reused = await ensureAgentStatusDaemon({
    panelHome,
    execPath: process.execPath,
    entryPath: daemonEntry,
    appVersion: APP_VERSION,
    timeoutMs: 5_000
  });
  assert.equal(reused.started, false, "an existing compatible daemon must be reused, not duplicated");
  assert.equal(reused.endpoint.pid, ensured.endpoint.pid);

  await stopAgentStatusDaemon(panelHome);
  assert.equal(await readLiveEndpoint(paths), null, "stopAgentStatusDaemon must remove the endpoint");
  assert.equal(fs.existsSync(paths.socket), false, "stopAgentStatusDaemon must release the socket");
  console.log("ok 17 - app lifecycle: ensure reuses a compatible daemon, stop releases the socket");
}

let failure = null;
try {
  await main();
} catch (error) {
  failure = error;
  for (const daemon of daemons) {
    console.error(`--- daemon pid ${daemon.child.pid} (exit ${daemon.child.exitCode}) ---`);
    console.error(daemon.logs.join("") || "(no output)");
  }
} finally {
  for (const pid of detachedPids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  for (const child of children) {
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
  }
  try {
    fs.rmSync(panelHome, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

if (failure) {
  console.error(failure);
  process.exit(1);
}
console.log("agent-status-daemon.test.mjs: all assertions passed");
