/**
 * Resolve CLI commands for GUI-launched Electron.
 *
 * Dock / Finder launches inherit a minimal PATH (often without Homebrew, fnm,
 * nvm, Volta). ACP agents default to `npx`, which then fails with spawn ENOENT.
 * The same is true of a Windows shortcut, which starts with the PATH the shell
 * had at login rather than the one the user's terminal profile builds.
 *
 * Resolution is delegated to `@agent-resume/core` so the desktop app and the
 * extension agree on PATHEXT order, `.cmd` shims, and case-insensitive PATH
 * keys.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  executableCandidates,
  pathextEntries,
  requiresWindowsShell,
  resolveExecutable as resolveExecutableInCore,
  spawnSpecFor
} from "@agent-resume/core";

function isExecutable(filePath: string): boolean {
  try {
    // On Windows an executability bit does not exist: the extension is the
    // contract, and `X_OK` there only checks existence (and succeeds for
    // directories), so a file check is the correct test.
    if (process.platform === "win32") return fs.statSync(filePath).isFile();
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function dirExists(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/** Parse fnm/nvm style folder names like v22.13.0 for newest-first sort. */
export function compareNodeVersionDir(a: string, b: string): number {
  const parse = (name: string): number[] => {
    const m = name.replace(/^v/i, "").match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    if (!m) return [0, 0, 0];
    return [Number(m[1] || 0), Number(m[2] || 0), Number(m[3] || 0)];
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pb[i]! - pa[i]!;
  }
  return b.localeCompare(a);
}

/**
 * fnm keeps its versions in a different shape per platform:
 *   POSIX:   `~/.local/share/fnm/node-versions/<v>/installation/bin`
 *   Windows: `%APPDATA%\fnm\node-versions\<v>\installation` (no `bin`)
 */
function collectFnmBinDirs(home: string): string[] {
  const roots = new Set<string>();
  if (process.platform === "win32") {
    const appData = process.env.APPDATA?.trim();
    const localAppData = process.env.LOCALAPPDATA?.trim();
    roots.add(process.env.FNM_DIR?.trim() || (appData ? path.join(appData, "fnm") : path.join(home, "AppData", "Roaming", "fnm")));
    if (localAppData) roots.add(path.join(localAppData, "fnm"));
  } else {
    roots.add(process.env.FNM_DIR?.trim() || path.join(home, ".local/share/fnm"));
    // Legacy / alternate locations
    roots.add(path.join(home, ".fnm"));
  }

  const bins: string[] = [];
  for (const root of roots) {
    if (!dirExists(root)) continue;
    const aliasBin = path.join(root, "aliases", "default", process.platform === "win32" ? "" : "bin");
    if (dirExists(aliasBin)) bins.push(aliasBin);

    const versionsRoot = path.join(root, "node-versions");
    if (!dirExists(versionsRoot)) continue;
    let versions: string[] = [];
    try {
      versions = fs.readdirSync(versionsRoot);
    } catch {
      continue;
    }
    versions.sort(compareNodeVersionDir);
    for (const version of versions) {
      const bin = path.join(versionsRoot, version, "installation", process.platform === "win32" ? "" : "bin");
      if (dirExists(bin)) bins.push(bin);
    }
  }
  return bins;
}

/**
 * nvm on Windows (nvm-windows) is a different project with a different layout:
 * `%NVM_SYMLINK%` points at the active Node install and `%NVM_HOME%` holds the
 * versions. Neither exists on POSIX, where nvm is a shell function over
 * `~/.nvm/versions/node/<v>/bin`.
 */
function collectNvmBinDirs(home: string): string[] {
  if (process.platform === "win32") {
    const dirs: string[] = [];
    const symlink = process.env.NVM_SYMLINK?.trim();
    if (symlink && dirExists(symlink)) dirs.push(symlink);
    const nvmHome = process.env.NVM_HOME?.trim();
    if (nvmHome) {
      const versionsRoot = path.join(nvmHome, "v");
      if (dirExists(versionsRoot)) {
        let versions: string[] = [];
        try {
          versions = fs.readdirSync(versionsRoot);
        } catch {
          versions = [];
        }
        versions.sort(compareNodeVersionDir);
        for (const version of versions) {
          const dir = path.join(versionsRoot, version);
          if (dirExists(dir)) dirs.push(dir);
        }
      }
    }
    return dirs;
  }
  const nvmDir = process.env.NVM_DIR?.trim() || path.join(home, ".nvm");
  const versionsRoot = path.join(nvmDir, "versions", "node");
  if (!dirExists(versionsRoot)) return [];
  let versions: string[] = [];
  try {
    versions = fs.readdirSync(versionsRoot);
  } catch {
    return [];
  }
  versions.sort(compareNodeVersionDir);
  const bins: string[] = [];
  for (const version of versions) {
    const bin = path.join(versionsRoot, version, "bin");
    if (dirExists(bin)) bins.push(bin);
  }
  return bins;
}

/** Extra directories GUI apps usually miss. */
export function collectExtraPathDirs(home = os.homedir()): string[] {
  const dirs: string[] = [];
  if (process.platform === "win32") {
    const appData = process.env.APPDATA?.trim() || path.join(home, "AppData", "Roaming");
    const localAppData = process.env.LOCALAPPDATA?.trim() || path.join(home, "AppData", "Local");
    const programFiles = process.env.ProgramFiles?.trim() || "C:\\Program Files";
    const systemRoot = process.env.SystemRoot?.trim() || "C:\\Windows";
    dirs.push(
      path.join(appData, "npm"),
      path.join(localAppData, "pnpm"),
      path.join(localAppData, "Volta", "bin"),
      path.join(localAppData, "Programs"),
      path.join(programFiles, "nodejs"),
      path.join(home, ".local", "bin"),
      path.join(home, ".cargo", "bin"),
      path.join(home, ".grok", "bin"),
      path.join(home, ".opencode", "bin"),
      path.join(systemRoot, "System32"),
      systemRoot
    );
  } else {
    dirs.push(
      "/opt/homebrew/bin",
      "/opt/homebrew/sbin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      path.join(home, ".local/bin"),
      path.join(home, ".npm-global/bin"),
      path.join(home, ".volta/bin"),
      path.join(home, ".asdf/shims"),
      path.join(home, ".cargo/bin"),
      path.join(home, ".grok/bin"),
      path.join(home, ".opencode/bin"),
      path.join(home, "Library/pnpm"),
      path.join(home, ".local/share/pnpm")
    );
  }
  dirs.push(...collectFnmBinDirs(home));
  dirs.push(...collectNvmBinDirs(home));
  return dirs.filter((dir, index, all) => all.indexOf(dir) === index && dirExists(dir));
}

/** Windows spells the PATH variable `Path`; a child env must not carry both. */
export function pathEnvKey(env: NodeJS.ProcessEnv): string {
  if (process.platform !== "win32") return "PATH";
  return Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
}

export function buildAugmentedPath(basePath = process.env.PATH || "", home = os.homedir()): string {
  const merged: string[] = [];
  const seen = new Set<string>();
  const normalize = (dir: string) =>
    process.platform === "win32" ? dir.toLowerCase() : dir;
  const push = (dir: string) => {
    if (!dir) return;
    const key = normalize(dir);
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(dir);
  };
  for (const dir of basePath.split(path.delimiter).filter(Boolean)) push(dir);
  for (const dir of collectExtraPathDirs(home)) push(dir);
  return merged.join(path.delimiter);
}

/**
 * Resolve a command name to an absolute executable path using PATH (+ extras).
 * Returns null when nothing executable is found.
 *
 * On Windows the result is an absolute `.exe`/`.cmd`/`.bat` path chosen in
 * PATHEXT order; callers that spawn it must go through `spawnSpecFor` (a
 * `.cmd` cannot be started by `spawn` without a shell).
 */
export function resolveExecutable(command: string, searchPath: string): string | null {
  return resolveExecutableInCore(command, searchPath, { isExecutable });
}

/** True when a resolved path needs `cmd.exe` to start on Windows. */
export function needsWindowsShell(command: string): boolean {
  return requiresWindowsShell(command);
}

export type ResolvedSpawn = {
  command: string;
  env: NodeJS.ProcessEnv;
  /** Absolute path when resolved; otherwise the original command name. */
  resolved: boolean;
  /** Windows: the `.cmd`/`.bat` shim needs `cmd.exe` to start. */
  shell: boolean;
  /** The exact argv a `spawn` call should use. */
  argv: string[];
};

/**
 * Build env with an augmented PATH and resolve `command` to an absolute path when possible.
 */
export function resolveSpawnCommand(
  command: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
  extraEnv?: Record<string, string>
): ResolvedSpawn {
  const env: NodeJS.ProcessEnv = { ...baseEnv, ...extraEnv };
  const key = pathEnvKey(env);
  const augmented = buildAugmentedPath(env[key] || process.env.PATH || "");
  env[key] = augmented;
  // Electron and Node read `HOME` on every platform; Windows only defines
  // `USERPROFILE`, and a tool that resolves `~` itself needs the alias.
  if (process.platform === "win32") {
    if (!env.USERPROFILE) env.USERPROFILE = os.homedir();
    if (!env.HOME) env.HOME = env.USERPROFILE;
  } else if (!env.HOME) {
    env.HOME = os.homedir();
  }

  const resolved = resolveExecutable(command, augmented);
  if (resolved) {
    return {
      command: resolved,
      env,
      resolved: true,
      shell: needsWindowsShell(resolved),
      argv: [resolved]
    };
  }
  return { command, env, resolved: false, shell: false, argv: [command] };
}

/** `spawn` options for a resolved command, with the `.cmd` shim handled. */
export function spawnSpecForCommand(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform
): ReturnType<typeof spawnSpecFor> {
  return spawnSpecFor(command, args, platform);
}

/** Exposed for tests and for callers that only need the candidate list. */
export { executableCandidates, pathextEntries };
