/**
 * Executable resolution and spawn preparation.
 *
 * On POSIX a command is a file with the execute bit. On Windows it is a name
 * looked up against `PATHEXT`, and the result may be a `.cmd`/`.bat` shim that
 * only `cmd.exe` can run. Both facts live here so callers stop re-deriving
 * them (and stop spawning `code` when the file is `code.cmd`).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { isWindows, type PlatformName } from "./platform";

/** PATHEXT default when the variable is missing or empty. */
export const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

export type ExecutableLookup = {
  /** Candidate names to try, in order, for one directory. */
  names: string[];
  /** True when the command already names a file (`tool.exe`, `tool.cmd`). */
  explicitExtension: boolean;
};

export function pathextEntries(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.PATHEXT?.trim() || DEFAULT_PATHEXT;
  return raw
    .split(";")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Names a bare command can resolve to on this platform.
 *
 * `.cmd` and `.bat` come after `.exe` so a real binary wins over a shim, which
 * is also what `cmd.exe` does.
 */
export function executableCandidates(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: PlatformName = process.platform
): ExecutableLookup {
  const name = command.trim();
  if (!isWindows(platform)) return { names: [name], explicitExtension: false };

  const ext = path.win32.extname(name).toLowerCase();
  if (ext) return { names: [name], explicitExtension: true };

  const extensions = pathextEntries(env);
  const ordered = [
    ...extensions.filter((entry) => entry === ".exe" || entry === ".com"),
    ...extensions.filter((entry) => entry !== ".exe" && entry !== ".com")
  ];
  return { names: ordered.map((entry) => `${name}${entry}`), explicitExtension: false };
}

/** True when `file` is something only `cmd.exe` can start. */
export function requiresWindowsShell(file: string, platform: PlatformName = process.platform): boolean {
  if (!isWindows(platform)) return false;
  const ext = path.win32.extname(file).toLowerCase();
  return ext === ".cmd" || ext === ".bat";
}

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function isExecutableFile(file: string, platform: PlatformName): boolean {
  if (!isFile(file)) return false;
  if (isWindows(platform)) return true;
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a command to an absolute path.
 *
 * `command` may be an absolute path, a path containing a separator, or a bare
 * name. Returns null when nothing matches.
 */
export function resolveExecutable(
  command: string,
  searchPath: string,
  options: {
    env?: NodeJS.ProcessEnv;
    platform?: PlatformName;
    /** Injectable for tests. */
    isExecutable?: (file: string, platform: PlatformName) => boolean;
  } = {}
): string | null {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const check = options.isExecutable ?? isExecutableFile;
  const api = platform === "win32" ? path.win32 : path.posix;

  const trimmed = command.trim();
  if (!trimmed) return null;

  const { names, explicitExtension } = executableCandidates(trimmed, env, platform);

  if (api.isAbsolute(trimmed) || trimmed.includes("/") || trimmed.includes("\\")) {
    const dir = api.dirname(trimmed);
    const base = api.basename(trimmed);
    const candidates = explicitExtension ? [trimmed] : executableCandidates(base, env, platform).names;
    for (const name of candidates) {
      const full = api.join(dir, name);
      if (check(full, platform)) return full;
    }
    return null;
  }

  const delimiter = platform === "win32" ? ";" : ":";
  for (const dir of searchPath.split(delimiter).filter(Boolean)) {
    for (const name of names) {
      const full = api.join(dir, name);
      if (check(full, platform)) return full;
    }
  }
  return null;
}

// ----------------------------------------------------------------- spawn shape

export type SpawnSpec = {
  /** Executable to hand to `child_process.spawn`. */
  file: string;
  args: string[];
  /** True when `file` is a shell that runs a command line, not an argv. */
  shell: boolean;
};

/** Quote one argument for `cmd.exe`'s command line. */
function quoteCmdArg(value: string): string {
  if (!/[\s"&<>|^()]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

/**
 * Prepare a spawn for a resolved executable.
 *
 * `.cmd`/`.bat` cannot be spawned directly on Windows; they are run through
 * `cmd.exe /d /s /c`. Arguments are quoted here rather than left to Node's
 * `shell: true`, whose joining does not escape `&`, `|`, `^` or `%`.
 */
export function spawnSpecFor(
  executable: string,
  args: readonly string[],
  platform: PlatformName = process.platform
): SpawnSpec {
  if (!requiresWindowsShell(executable, platform)) {
    return { file: executable, args: [...args], shell: false };
  }
  const inner = [executable, ...args].map(quoteCmdArg).join(" ");
  // `/s` makes cmd strip exactly the outer pair of quotes and run the rest
  // verbatim; the doubled quotes keep a path with spaces intact.
  return { file: "cmd.exe", args: ["/d", "/s", "/c", `"${inner}"`], shell: false };
}

/** Command line for display / clipboard when a shell will run it. */
export function commandLineFor(executable: string, args: readonly string[], platform: PlatformName = process.platform): string {
  const spec = spawnSpecFor(executable, args, platform);
  if (!spec.shell && spec.file === executable) {
    return [executable, ...args.map((arg) => quoteCmdArg(arg))].join(" ");
  }
  return [spec.file, ...spec.args].join(" ");
}
