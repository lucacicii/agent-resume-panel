/**
 * `agent-resume-status` CLI — the report path for installed agent hooks.
 *
 * A hook runs inside the agent's own process tree, so it must be fast, silent,
 * and incapable of failing the agent: every error path exits 0 without touching
 * stdout (some agents parse hook stdout as instructions). The state and the
 * event are decided at install time (`hooks.ts`), so this only has to deliver
 * one report.
 *
 * Invoked as `ELECTRON_RUN_AS_NODE=1 <app> <this file> report …` by the shell
 * wrapper that `integrations/wrapper.ts` materializes.
 */

import { connectAgentStatusClient } from "./client";
import { readEndpointFile } from "./endpoint";
import { agentStatusPaths } from "./paths";
import { resolvePanelHome } from "@agent-resume/core";
import type { AgentKind, AgentState, NativeReport } from "./types";

/** Connection budget for one report. Hooks run in the agent's critical path. */
const CONNECT_TIMEOUT_MS = 300;
const REQUEST_TIMEOUT_MS = 800;
const AGENT_KINDS: readonly AgentKind[] = [
  "claude",
  "codex",
  "pi",
  "opencode",
  "grok",
  "cursor",
  "agy",
  "prime",
  "unknown"
];
const STATE_ALIASES: Record<string, AgentState> = {
  idle: "idle",
  open: "idle",
  done: "idle",
  working: "working",
  running: "working",
  busy: "working",
  blocked: "blocked",
  awaiting: "blocked",
  waiting: "blocked"
};

let sequence = 0;

export function panelHomeFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return resolvePanelHome(env.AGENT_RESUME_PANEL_HOME);
}

/**
 * Monotonic per process: the daemon drops a report whose sequence is not newer
 * than the one it already has for that pane.
 */
export function nextSequence(now = Date.now()): number {
  sequence = (sequence + 1) % 1_000;
  return now * 1_000 + sequence;
}

export function parseReportArgs(argv: readonly string[]): NativeReport | null {
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (!arg.startsWith("--")) continue;
    const [flag, inline] = arg.includes("=")
      ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)]
      : [arg, argv[index + 1]];
    if (inline === undefined || inline.startsWith("--")) continue;
    flags.set(flag, inline);
    if (!arg.includes("=")) index += 1;
  }

  const paneId = Number(flags.get("--pane"));
  if (!Number.isInteger(paneId) || paneId <= 0) return null;

  const state = STATE_ALIASES[(flags.get("--state") ?? "").toLowerCase()];
  if (!state) return null;

  const agentFlag = (flags.get("--agent") ?? "unknown").toLowerCase() as AgentKind;
  const agent = AGENT_KINDS.includes(agentFlag) ? agentFlag : "unknown";
  const source = flags.get("--source")?.trim() || `agent-resume:${agent}`;

  const report: NativeReport = {
    paneId,
    source: source.slice(0, 120),
    agent,
    state,
    seq: nextSequence()
  };
  const sessionRef = flags.get("--session-ref")?.trim();
  if (sessionRef) {
    const separator = sessionRef.indexOf(":");
    if (separator > 0) {
      report.sessionRef = {
        provider: sessionRef.slice(0, separator),
        sessionId: sessionRef.slice(separator + 1)
      };
    }
  }
  if (flags.get("--subagent") === "true") report.subagent = true;
  return report;
}

/** @returns a process exit code; every failure is silent by design. */
export async function reportState(
  report: NativeReport,
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  const paths = agentStatusPaths(panelHomeFromEnv(env));
  const endpoint = await readEndpointFile(paths);
  if (!endpoint) return 0;
  try {
    const client = await connectAgentStatusClient({
      socketPath: endpoint.socketPath,
      role: "cli",
      connectTimeoutMs: CONNECT_TIMEOUT_MS
    });
    await client.request("pane.report_state", report, REQUEST_TIMEOUT_MS);
    client.close();
  } catch {
    // The daemon may be restarting; a dropped report is better than a stalled hook.
  }
  return 0;
}

const USAGE = `agent-resume-status report --pane <id> --state <idle|working|blocked> [--agent <kind>] [--source <name>] [--session-ref <provider:id>] [--subagent true]`;

export async function runCli(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  const [command] = argv;
  if (command !== "report") {
    if (env.AGENT_RESUME_STATUS_DEBUG === "1") console.error(USAGE);
    return 0;
  }
  const report = parseReportArgs(argv.slice(1));
  if (!report) {
    if (env.AGENT_RESUME_STATUS_DEBUG === "1") console.error(`could not parse: ${USAGE}`);
    return 0;
  }
  if (env.AGENT_RESUME_STATUS_DEBUG === "1") {
    console.error(`reporting ${JSON.stringify(report)}`);
  }
  return reportState(report, env);
}

if (require.main === module) {
  void runCli().then((code) => {
    process.exitCode = code;
  });
}
