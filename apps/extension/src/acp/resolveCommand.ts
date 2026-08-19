/**
 * Resolve CLI commands for the VS Code extension host.
 *
 * A GUI-launched VS Code (Finder / Dock) inherits a minimal PATH (often
 * without Homebrew, fnm, nvm, Volta). ACP agents default to `prime-agent`,
 * `npx`, etc., which then fail with spawn ENOENT. Mirrors the desktop app's
 * `apps/desktop/src/main/processPath.ts` so the extension finds the same
 * common install locations and surfaces a clear error instead of a 60s wait.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

function isExecutable(filePath: string): boolean {
  try {
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

function collectFnmBinDirs(home: string): string[] {
  const roots = new Set<string>();
  const fnmDir = process.env.FNM_DIR?.trim() || path.join(home, ".local/share/fnm");
  roots.add(fnmDir);
  // Legacy / alternate locations
  roots.add(path.join(home, ".fnm"));

  const bins: string[] = [];
  for (const root of roots) {
    if (!dirExists(root)) continue;
    const aliasBin = path.join(root, "aliases", "default", "bin");
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
      const bin = path.join(versionsRoot, version, "installation", "bin");
      if (dirExists(bin)) bins.push(bin);
    }
  }
  return bins;
}

function collectNvmBinDirs(home: string): string[] {
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
  const dirs: string[] = [
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
  ];
  dirs.push(...collectFnmBinDirs(home));
  dirs.push(...collectNvmBinDirs(home));
  return dirs.filter((dir, index, all) => all.indexOf(dir) === index && dirExists(dir));
}

export function buildAugmentedPath(basePath = process.env.PATH || "", home = os.homedir()): string {
  const merged: string[] = [];
  const seen = new Set<string>();
  const push = (dir: string) => {
    if (!dir || seen.has(dir)) return;
    seen.add(dir);
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
  const trimmed = command.trim();
  if (!trimmed) return null;
  if (path.isAbsolute(trimmed) || trimmed.includes(path.sep) || trimmed.includes("/")) {
    return isExecutable(trimmed) ? trimmed : null;
  }

  const names =
    process.platform === "win32"
      ? [trimmed, `${trimmed}.cmd`, `${trimmed}.exe`, `${trimmed}.bat`]
      : [trimmed];

  for (const dir of searchPath.split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const full = path.join(dir, name);
      if (isExecutable(full)) return full;
    }
  }
  return null;
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
  const augmented = buildAugmentedPath(env.PATH || process.env.PATH || "");
  env.PATH = augmented;
  if (!env.HOME) env.HOME = os.homedir();

  const resolved = resolveExecutable(command, augmented);
  if (resolved) {
    return { command: resolved, env, resolved: true };
  }
  return { command, env, resolved: false };
}
