/**
 * The shell wrapper installed hooks call.
 *
 * It exists for three reasons:
 *   1. hooks must be silent — some agents parse hook stdout as instructions, so
 *      all output is redirected to an append-only log;
 *   2. hooks must never fail the agent — every path exits 0;
 *   3. the pane identity gate lives here: only panes this app spawned export
 *      `AGENT_RESUME_PANE_ID`, so a globally installed hook does nothing in a
 *      terminal we do not manage.
 *
 * `$1` is the state decided at install time (see `claude.ts` / `codex.ts`), so no
 * JSON parsing of the hook payload is needed beyond the session id.
 */

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { agentStatusDir, resolvePanelHome } from "@agent-resume/core";

/** Where the wrapper, its log, and per-agent config live under the panel home. */
export function agentStateDir(panelHome: string): string {
  return path.join(resolvePanelHome(panelHome), ".desktop", "agent-state");
}

export function wrapperPath(panelHome: string, agent: string): string {
  return path.join(agentStateDir(panelHome), `agent-resume-status-${agent}.sh`);
}

export function reportLogPath(panelHome: string): string {
  return path.join(agentStateDir(panelHome), "report.log");
}

export type WrapperConfig = {
  panelHome: string;
  /** Absolute path of the app executable used as the Node runtime. */
  execPath: string;
  /** Absolute path of the compiled CLI inside the app bundle. */
  cliPath: string;
  agent: string;
};

export function buildWrapperScript(config: WrapperConfig): string {
  const log = reportLogPath(config.panelHome);
  return `#!/bin/sh
# installed by Agent Resume; managed file - reinstall overwrites it.
# usage: $0 <idle|working|blocked> [provider:sessionId]
set -u

state="\${1:-}"
[ -n "$state" ] || exit 0

# Only panes this app spawned carry the id; other terminals are none of our business.
[ -n "\${AGENT_RESUME_PANE_ID:-}" ] || exit 0
pane="\${AGENT_RESUME_PANE_ID}"

log=${shellQuote(log)}
{
  echo "[\$(date -u +%Y-%m-%dT%H:%M:%SZ)] pane=\$pane state=\$state agent=${config.agent}"
} >>"$log" 2>/dev/null

# Hook payload on stdin: ignore everything except the session id, and never let a
# sub-agent hook claim the pane's state.
payload="\$(cat 2>/dev/null | tr -d '\\n')"
case "$payload" in
  *'"agent_id"'*) exit 0 ;;
esac
session=""
case "$payload" in
  *'"session_id"'*)
    session="\$(printf '%s' "$payload" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p')"
    ;;
esac
[ -n "\${2:-}" ] && session="\$2"

{
  ELECTRON_RUN_AS_NODE=1 AGENT_RESUME_PANEL_HOME=${shellQuote(resolvePanelHome(config.panelHome))} \\
    ${shellQuote(config.execPath)} ${shellQuote(config.cliPath)} report \\
    --pane "$pane" --agent ${config.agent} --source agent-resume:${config.agent} --state "$state" \\
    \${session:+--session-ref "${config.agent}:\$session"}
} >>"$log" 2>&1

exit 0
`;
}

/** Write (or refresh) the wrapper. Safe to call on every install. */
export function materializeWrapper(config: WrapperConfig): string {
  const dir = agentStateDir(config.panelHome);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = wrapperPath(config.panelHome, config.agent);
  writeFileSync(target, buildWrapperScript(config), { mode: 0o700 });
  chmodSync(target, 0o700);
  return target;
}

export function readWrapper(config: WrapperConfig): string | null {
  try {
    return readFileSync(wrapperPath(config.panelHome, config.agent), "utf8");
  } catch {
    return null;
  }
}

/** True when a command line is one of our wrappers. */
export function isOurCommand(command: string, config: Pick<WrapperConfig, "panelHome">): boolean {
  return command.includes(`${path.sep}.desktop${path.sep}agent-state${path.sep}agent-resume-status-`)
    || command.includes(agentStatusDir(config.panelHome));
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
