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

import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { agentStatusDir, resolvePanelHome } from "@agent-resume/core";

/** Where the wrapper, its log, and per-agent config live under the panel home. */
function agentStateDir(panelHome: string): string {
  return path.join(resolvePanelHome(panelHome), ".desktop", "agent-state");
}

/**
 * The wrapper's extension decides how the hook runs it.
 *
 * POSIX hooks are exec'd by a shell (`sh`), so they need a shebang. Windows
 * hooks are started through `cmd.exe`, which can only run an executable or a
 * `.cmd`/`.bat` batch file — a shebang in a `.sh` is just a comment, and the
 * hook would silently do nothing.
 */
function wrapperFileName(agent: string): string {
  return process.platform === "win32"
    ? `agent-resume-status-${agent}.cmd`
    : `agent-resume-status-${agent}.sh`;
}

function wrapperPath(panelHome: string, agent: string): string {
  return path.join(agentStateDir(panelHome), wrapperFileName(agent));
}

function reportLogPath(panelHome: string): string {
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

function buildWrapperScript(config: WrapperConfig): string {
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

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * The Windows wrapper.
 *
 * Same three guarantees as the POSIX script, with cmd.exe primitives:
 *   - `%1` is the state, `%2` an optional session ref;
 *   - the pane gate reads `%AGENT_RESUME_PANE_ID%`;
 *   - stdin (the hook payload) is read into a temp file so the session id can be
 *     extracted without shell string surgery, and a payload containing
 *     `"agent_id"` (a sub-agent hook) exits before reporting;
 *   - every failure path ends in `exit /b 0`.
 *
 * `setlocal EnableExtensions DisableDelayedExpansion` keeps paths containing `!`
 * intact. Every path is quoted, so `&`, `^` and spaces in a user name are safe.
 */
function buildCmdWrapperScript(config: WrapperConfig): string {
  const log = reportLogPath(config.panelHome);
  const home = resolvePanelHome(config.panelHome);
  return [
    "@echo off",
    "rem installed by Agent Resume; managed file - reinstall overwrites it.",
    "rem usage: %~nx0 <idle|working|blocked> [provider:sessionId]",
    "setlocal EnableExtensions DisableDelayedExpansion",
    "",
    'set "state=%~1"',
    "if not defined state exit /b 0",
    "",
    "rem Only panes this app spawned carry the id; other terminals are none of our business.",
    "if not defined AGENT_RESUME_PANE_ID exit /b 0",
    `set "log=${log}"`,
    `>>"%log%" echo [%DATE% %TIME%] pane=%AGENT_RESUME_PANE_ID% state=%state% agent=${config.agent}`,
    "",
    'set "payload=%TEMP%\\agent-resume-payload-%RANDOM%%RANDOM%.txt"',
    'set "session="',
    'if exist "%payload%" del /q "%payload%" >nul 2>&1',
    "more > \"%payload%\" 2>nul",
    'findstr /c:"\\"agent_id\\"" "%payload%" >nul 2>&1',
    "if not errorlevel 1 goto cleanup",
    'for /f "tokens=2 delims=:\\"" %%A in (\'findstr /c:"\\"session_id\\"" "%payload%" 2^>nul\') do if not defined session set "session=%%A"',
    'if not "%~2"=="" set "session=%~2"',
    "",
    'set "ELECTRON_RUN_AS_NODE=1"',
    `set "AGENT_RESUME_PANEL_HOME=${home}"`,
    "if defined session (",
    `  "${config.execPath}" "${config.cliPath}" report --pane "%AGENT_RESUME_PANE_ID%" --agent ${config.agent} --source agent-resume:${config.agent} --state "%state%" --session-ref "${config.agent}:%session%" >>"%log%" 2>&1`,
    ") else (",
    `  "${config.execPath}" "${config.cliPath}" report --pane "%AGENT_RESUME_PANE_ID%" --agent ${config.agent} --source agent-resume:${config.agent} --state "%state%" >>"%log%" 2>&1`,
    ")",
    "",
    ":cleanup",
    'if exist "%payload%" del /q "%payload%" >nul 2>&1',
    "endlocal",
    "exit /b 0",
    ""
  ].join("\r\n");
}

/** Write (or refresh) the wrapper. Safe to call on every install. */
export function materializeWrapper(config: WrapperConfig): string {
  const dir = agentStateDir(config.panelHome);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = wrapperPath(config.panelHome, config.agent);
  writeFileSync(
    target,
    process.platform === "win32" ? buildCmdWrapperScript(config) : buildWrapperScript(config),
    { mode: 0o700 }
  );
  // Mode bits mean nothing on Windows; the file is executable by extension.
  if (process.platform !== "win32") chmodSync(target, 0o700);
  return target;
}

/** True when a command line is one of our wrappers. */
export function isOurCommand(command: string, config: Pick<WrapperConfig, "panelHome">): boolean {
  return command.includes(`${path.sep}.desktop${path.sep}agent-state${path.sep}agent-resume-status-`)
    || command.includes(agentStatusDir(config.panelHome));
}
