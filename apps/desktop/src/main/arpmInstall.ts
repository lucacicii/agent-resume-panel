import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import * as path from "node:path";

const MANAGED_MARKER = "installed by Agent Resume; managed file";

/**
 * On Windows there is no `~/.local/bin`; the user-writable location that is
 * already on `Path` for most installs is `%LOCALAPPDATA%\Programs`.
 */
function defaultArpmBinDir(platform = process.platform): string {
  if (platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA?.trim() || path.join(homedir(), "AppData", "Local");
    return path.join(localAppData, "Programs");
  }
  return path.join(homedir(), ".local", "bin");
}

/** The shim filename for `binDir`, so callers can report/skip without guessing. */
export function arpmShimFileName(platform = process.platform): string {
  return platform === "win32" ? "arpm.cmd" : "arpm";
}

export function resolveArpmCliPath(options: {
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
}): string {
  const fileName = "arpm.js";
  const relative = path.join("settings", fileName);
  const candidates: string[] = [];

  try {
    const require = createRequire(__filename);
    const coreMain = require.resolve("@agent-resume/core");
    candidates.push(path.join(path.dirname(coreMain), relative));
  } catch {
    // fall through
  }

  if (options.isPackaged) {
    candidates.push(
      path.join(options.resourcesPath, "app.asar.unpacked", "node_modules", "@agent-resume", "core", "dist", relative),
      path.join(options.resourcesPath, "app.asar", "node_modules", "@agent-resume", "core", "dist", relative),
      path.join(options.appPath, "node_modules", "@agent-resume", "core", "dist", relative)
    );
  } else {
    candidates.push(
      path.join(options.appPath, "..", "..", "packages", "core", "dist", relative),
      path.join(options.appPath, "node_modules", "@agent-resume", "core", "dist", relative)
    );
  }

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  throw new Error(
    "Unable to resolve arpm CLI (packages/core dist/settings/arpm.js). Rebuild @agent-resume/core and Desktop."
  );
}

export function buildArpmShim(input: {
  execPath: string;
  cliPath: string;
  panelHome: string;
}): string {
  return `#!/bin/sh
# ${MANAGED_MARKER} - Desktop rewrites this on launch.
set -e
export ELECTRON_RUN_AS_NODE=1
export AGENT_RESUME_PANEL_HOME=${shellQuote(input.panelHome)}
exec ${shellQuote(input.execPath)} ${shellQuote(input.cliPath)} "$@"
`;
}

/**
 * `arpm.cmd` for cmd.exe and PowerShell.
 *
 * `%~dp0` is the shim's own directory, so the script is relocatable. The `""`
 * after `cmd.exe` keeps a path with spaces intact; `%*` forwards the arguments
 * verbatim (batch re-parses them, but that is exactly what the shim is for).
 */
export function buildArpmCmdShim(input: {
  execPath: string;
  cliPath: string;
  panelHome: string;
}): string {
  return `@echo off\r
rem ${MANAGED_MARKER} - Desktop rewrites this on launch.\r
setlocal\r
set "ELECTRON_RUN_AS_NODE=1"\r
set "AGENT_RESUME_PANEL_HOME=${input.panelHome}"\r
"${input.execPath}" "${input.cliPath}" %*\r
exit /b %ERRORLEVEL%\r
`;
}

export function isManagedArpmShim(content: string | null): boolean {
  return Boolean(content && content.includes(MANAGED_MARKER));
}

export function installArpmShim(input: {
  execPath: string;
  cliPath: string;
  panelHome: string;
  binDir?: string;
  /** Injectable for tests; defaults to the running platform. */
  platform?: NodeJS.Platform;
}): { path: string; written: boolean; skipped?: string } {
  const platform = input.platform ?? process.platform;
  const binDir = input.binDir || defaultArpmBinDir(platform);
  // `cmd.exe` only finds a command through `PATHEXT`, so the Windows shim must
  // carry the extension. PowerShell finds `arpm.cmd` through the same lookup.
  const target = path.join(binDir, arpmShimFileName(platform));
  const next = platform === "win32" ? buildArpmCmdShim(input) : buildArpmShim(input);
  mkdirSync(binDir, { recursive: true, mode: 0o755 });

  let previous: string | null = null;
  try {
    previous = readFileSync(target, "utf8");
  } catch {
    previous = null;
  }
  if (previous !== null && !isManagedArpmShim(previous)) {
    return { path: target, written: false, skipped: "existing arpm is not managed by Agent Resume" };
  }
  if (previous === next) {
    return { path: target, written: false };
  }
  writeFileSync(target, next, { mode: 0o755 });
  if (platform !== "win32") {
    // Extension is the contract on Windows; the mode bit only matters on POSIX.
    chmodSync(target, 0o755);
  }
  return { path: target, written: true };
}

export const ARPM_RC_BEGIN = "# >>> agent-resume arpm >>>";
const ARPM_RC_END = "# <<< agent-resume arpm <<<";

/** PowerShell block markers (a `.ps1` profile cannot use `#`-only POSIX sourcing). */
export const ARPM_PROFILE_BEGIN = "# >>> agent-resume arpm >>>";
const ARPM_PROFILE_END = "# <<< agent-resume arpm <<<";

function arpmHookPath(panelHome: string): string {
  return path.join(panelHome, ".desktop", "arpm.sh");
}

function arpmPowerShellHookPath(panelHome: string): string {
  return path.join(panelHome, ".desktop", "arpm.ps1");
}

function buildArpmShellHook(): string {
  return `# ${MANAGED_MARKER} - Desktop rewrites this on launch.
# Source from ~/.zshrc or ~/.bashrc so "arpm go <id>" cds in the current shell.
arpm() {
  if [ "$1" = "go" ]; then
    _arpm_print_cwd=0
    _arpm_launch=0
    for _arpm_arg in "$@"; do
      if [ "$_arpm_arg" = "--print-cwd" ]; then _arpm_print_cwd=1; fi
      if [ "$_arpm_arg" = "--launch" ]; then _arpm_launch=1; fi
    done
    if [ "$_arpm_print_cwd" -eq 1 ] || [ "$_arpm_launch" -eq 1 ]; then
      command arpm "$@"
      return $?
    fi
    if [ -z "\${2:-}" ]; then
      command arpm "$@"
      return $?
    fi
    command arpm prompt "$2" || return $?
    _arpm_cwd="$(command arpm go "$2" --print-cwd)" || return $?
    builtin cd "$_arpm_cwd"
    return $?
  fi
  command arpm "$@"
}
`;
}

/**
 * PowerShell equivalent of the POSIX hook.
 *
 * A child process cannot change its parent's working directory, so `arpm go`
 * is wrapped as a function that asks the CLI for the path and calls
 * `Set-Location` in the caller's session.
 */
function buildArpmPowerShellHook(shimPath: string): string {
  const shim = powerShellQuote(shimPath);
  return `# ${MANAGED_MARKER} - Desktop rewrites this on launch.
# Dot-source from $PROFILE so "arpm go <id>" changes the current location.
function global:arpm {
  $arguments = @($args)
  if ($arguments.Count -gt 0 -and $arguments[0] -eq "go") {
    $hasFlag = $false
    foreach ($item in $arguments) {
      if ($item -eq "--print-cwd" -or $item -eq "--launch") { $hasFlag = $true }
    }
    if ($hasFlag -or $arguments.Count -lt 2) {
      & ${shim} @arguments
      return
    }
    & ${shim} prompt $arguments[1]
    if ($LASTEXITCODE -ne 0) { return }
    $target = & ${shim} go $arguments[1] --print-cwd
    if ($LASTEXITCODE -ne 0) { return }
    Set-Location -LiteralPath $target
    return
  }
  & ${shim} @arguments
}
`;
}

function buildArpmRcSnippet(hookPath: string): string {
  return `${ARPM_RC_BEGIN}\n[ -f ${shellQuote(hookPath)} ] && . ${shellQuote(hookPath)}\n${ARPM_RC_END}\n`;
}

function buildArpmProfileSnippet(hookPath: string, binDir: string): string {
  // Put the shim directory on PATH for this session so `arpm` also works from
  // cmd.exe-style invocations started by the profile.
  return `${ARPM_PROFILE_BEGIN}\n$env:Path = ${powerShellQuote(`${binDir};`)} + $env:Path\nif (Test-Path -LiteralPath ${powerShellQuote(hookPath)}) { . ${powerShellQuote(hookPath)} }\n${ARPM_PROFILE_END}\n`;
}

function upsertArpmRcBlock(rcPath: string, snippet: string, begin = ARPM_RC_BEGIN, end = ARPM_RC_END): { path: string; written: boolean } {
  let text = "";
  try {
    text = readFileSync(rcPath, "utf8");
  } catch {
    text = "";
  }
  const block = snippet.trim();
  if (text.includes(begin) && text.includes(end)) {
    const escapedBegin = begin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedEnd = end.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const next = text.replace(
      new RegExp(`${escapedBegin}[\\s\\S]*?${escapedEnd}`),
      block
    );
    if (next === text) return { path: rcPath, written: false };
    writeFileSync(rcPath, next.endsWith("\n") ? next : `${next}\n`, { mode: 0o644 });
    return { path: rcPath, written: true };
  }
  const prefix = text && !text.endsWith("\n") ? "\n" : "";
  writeFileSync(rcPath, `${text}${prefix}\n${block}\n`, { mode: 0o644 });
  return { path: rcPath, written: true };
}

/**
 * Default `$PROFILE` locations.
 *
 * `$PROFILE` differs per host: Windows PowerShell 5.1 reads
 * `Documents\WindowsPowerShell\profile.ps1`, PowerShell 7 reads
 * `Documents\PowerShell\profile.ps1`. Both are documented and stable, so the
 * desktop can write them without starting a shell.
 */
export function defaultPowerShellProfilePaths(homeDir = homedir()): string[] {
  return [
    path.join(homeDir, "Documents", "WindowsPowerShell", "profile.ps1"),
    path.join(homeDir, "Documents", "PowerShell", "profile.ps1")
  ];
}

export function installArpmShell(input: {
  panelHome: string;
  homeDir?: string;
  /** Injectable for tests; defaults to the running platform. */
  platform?: NodeJS.Platform;
}): { hookPath: string; rcPaths: string[] } {
  const home = input.homeDir || homedir();
  const platform = input.platform ?? process.platform;
  if (platform === "win32") {
    const hookPath = arpmPowerShellHookPath(input.panelHome);
    mkdirSync(path.dirname(hookPath), { recursive: true });
    const binDir = defaultArpmBinDir(platform);
    const hook = buildArpmPowerShellHook(path.join(binDir, arpmShimFileName(platform)));
    let previous: string | null = null;
    try {
      previous = readFileSync(hookPath, "utf8");
    } catch {
      previous = null;
    }
    if (previous !== hook) writeFileSync(hookPath, hook, { mode: 0o644 });

    const snippet = buildArpmProfileSnippet(hookPath, binDir);
    const written: string[] = [];
    for (const profilePath of defaultPowerShellProfilePaths(home)) {
      mkdirSync(path.dirname(profilePath), { recursive: true });
      const result = upsertArpmRcBlock(profilePath, snippet, ARPM_PROFILE_BEGIN, ARPM_PROFILE_END);
      if (result.written) written.push(result.path);
    }
    return { hookPath, rcPaths: written };
  }

  const hookPath = arpmHookPath(input.panelHome);
  mkdirSync(path.dirname(hookPath), { recursive: true, mode: 0o755 });
  const hook = buildArpmShellHook();
  let previous: string | null = null;
  try {
    previous = readFileSync(hookPath, "utf8");
  } catch {
    previous = null;
  }
  if (previous !== hook) {
    writeFileSync(hookPath, hook, { mode: 0o644 });
  }
  const snippet = buildArpmRcSnippet(hookPath);
  const rcPaths = [path.join(home, ".zshrc"), path.join(home, ".bashrc")];
  const written: string[] = [];
  for (const rcPath of rcPaths) {
    const result = upsertArpmRcBlock(rcPath, snippet);
    if (result.written) written.push(result.path);
  }
  return { hookPath, rcPaths: written };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function powerShellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
