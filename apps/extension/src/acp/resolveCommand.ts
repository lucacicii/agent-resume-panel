/**
 * Resolve CLI commands for the VS Code extension host.
 *
 * A GUI-launched VS Code inherits a minimal PATH (often without Homebrew, fnm,
 * nvm, Volta) — and on Windows a shortcut starts with the PATH the shell had at
 * login, not the one the user's terminal profile builds. ACP agents default to
 * `prime-agent`, `npx`, etc., which then fail with spawn ENOENT.
 *
 * The search itself lives in `@agent-resume/core` so the extension and the
 * desktop app agree on PATHEXT order, `.cmd` shims, and case-insensitive PATH
 * keys.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveExecutable as resolveExecutableInCore } from "@agent-resume/core";

function isExecutable(filePath: string): boolean {
  try {
    // Windows has no execute bit; the extension is the contract and `X_OK`
    // there only checks existence (directories pass), so require a file.
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
function compareNodeVersionDir(a: string, b: string): number {
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
 * fnm versions live in `node-versions/<v>/installation` on Windows (the binaries
 * sit directly there) and in `…/installation/bin` on POSIX.
 */
function collectFnmBinDirs(home: string): string[] {
  const binLeaf = process.platform === "win32" ? "" : "bin";
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
    const aliasBin = path.join(root, "aliases", "default", binLeaf);
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
      const bin = path.join(versionsRoot, version, "installation", binLeaf);
      if (dirExists(bin)) bins.push(bin);
    }
  }
  return bins;
}

/** nvm-windows keeps the active install behind `%NVM_SYMLINK%`. */
function collectNvmBinDirs(home: string): string[] {
  if (process.platform === "win32") {
    const dirs: string[] = [];
    const symlink = process.env.NVM_SYMLINK?.trim();
    if (symlink && dirExists(symlink)) dirs.push(symlink);
    const nvmHome = process.env.NVM_HOME?.trim();
    const versionsRoot = nvmHome ? path.join(nvmHome, "v") : "";
    if (versionsRoot && dirExists(versionsRoot)) {
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
function pathKey(env: NodeJS.ProcessEnv): string {
  if (process.platform !== "win32") return "PATH";
  return Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
}

export function buildAugmentedPath(basePath = process.env.PATH || "", home = os.homedir()): string {
  const merged: string[] = [];
  const seen = new Set<string>();
  const normalize = (dir: string) => (process.platform === "win32" ? dir.toLowerCase() : dir);
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
 */
export function resolveExecutable(command: string, searchPath: string): string | null {
  return resolveExecutableInCore(command, searchPath, { isExecutable });
}

export type ResolvedSpawn = {
  command: string;
  env: NodeJS.ProcessEnv;
  /** Absolute path when resolved; otherwise the original command name. */
  resolved: boolean;
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
  const key = pathKey(env);
  const augmented = buildAugmentedPath(env[key] || process.env.PATH || "");
  env[key] = augmented;
  // Windows only defines USERPROFILE; tools that resolve `~` need HOME too.
  if (process.platform === "win32") {
    if (!env.USERPROFILE) env.USERPROFILE = os.homedir();
    if (!env.HOME) env.HOME = env.USERPROFILE;
  } else if (!env.HOME) {
    env.HOME = os.homedir();
  }

  const resolved = resolveExecutable(command, augmented);
  if (resolved) {
    return { command: resolved, env, resolved: true };
  }
  return { command, env, resolved: false };
}
