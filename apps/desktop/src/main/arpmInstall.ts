import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import * as path from "node:path";

const MANAGED_MARKER = "installed by Agent Resume; managed file";

function defaultArpmBinDir(): string {
  return path.join(homedir(), ".local", "bin");
}

function arpmShimPath(binDir = defaultArpmBinDir()): string {
  return path.join(binDir, "arpm");
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

export function isManagedArpmShim(content: string | null): boolean {
  return Boolean(content && content.includes(MANAGED_MARKER));
}

export function installArpmShim(input: {
  execPath: string;
  cliPath: string;
  panelHome: string;
  binDir?: string;
}): { path: string; written: boolean; skipped?: string } {
  const binDir = input.binDir || defaultArpmBinDir();
  const target = arpmShimPath(binDir);
  const next = buildArpmShim(input);
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
  chmodSync(target, 0o755);
  return { path: target, written: true };
}

export const ARPM_RC_BEGIN = "# >>> agent-resume arpm >>>";
const ARPM_RC_END = "# <<< agent-resume arpm <<<";

function arpmHookPath(panelHome: string): string {
  return path.join(panelHome, ".desktop", "arpm.sh");
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

function buildArpmRcSnippet(hookPath: string): string {
  return `${ARPM_RC_BEGIN}\n[ -f ${shellQuote(hookPath)} ] && . ${shellQuote(hookPath)}\n${ARPM_RC_END}\n`;
}

function upsertArpmRcBlock(rcPath: string, snippet: string): { path: string; written: boolean } {
  let text = "";
  try {
    text = readFileSync(rcPath, "utf8");
  } catch {
    text = "";
  }
  const block = snippet.trim();
  if (text.includes(ARPM_RC_BEGIN) && text.includes(ARPM_RC_END)) {
    const next = text.replace(
      /# >>> agent-resume arpm >>>[\s\S]*?# <<< agent-resume arpm <<</,
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

export function installArpmShell(input: {
  panelHome: string;
  homeDir?: string;
}): { hookPath: string; rcPaths: string[] } {
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
  const home = input.homeDir || homedir();
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
