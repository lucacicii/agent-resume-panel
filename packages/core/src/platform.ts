/**
 * Platform primitives shared by the Desktop app and the extension.
 *
 * Everything here is pure and takes an explicit `platform` option so win32
 * behaviour is testable from macOS. Callers default to `process.platform`.
 *
 * Three concerns live here because they always travel together:
 *   - path identity (case-insensitive, separator-agnostic, `\\?\`-tolerant),
 *   - shell quoting (POSIX / PowerShell / cmd are not interchangeable),
 *   - Windows executable rules (`PATHEXT`, batch shims, reserved names).
 */

import * as path from "node:path";

export type PlatformName = NodeJS.Platform;

/** Shell dialect a generated command line will be typed into. */
export type ShellKind = "posix" | "powershell" | "cmd";

export function pathApiFor(platform: PlatformName = process.platform): path.PlatformPath {
  return platform === "win32" ? path.win32 : path.posix;
}

export function isWindows(platform: PlatformName = process.platform): boolean {
  return platform === "win32";
}

/** The shell the app opens when it is not told otherwise. */
export function defaultShellKind(platform: PlatformName = process.platform): ShellKind {
  return platform === "win32" ? "powershell" : "posix";
}

/** Which quoting dialect a shell executable speaks. */
export function shellKindForExecutable(executable: string, platform: PlatformName = process.platform): ShellKind {
  if (platform !== "win32") return "posix";
  const base = path.win32.basename(executable).toLowerCase().replace(/\.exe$/, "");
  if (base === "cmd") return "cmd";
  if (base === "powershell" || base === "pwsh" || base === "powershell_ise") return "powershell";
  // Git Bash, WSL and friends are POSIX shells running on Windows.
  if (base === "bash" || base === "zsh" || base === "sh" || base === "dash") return "posix";
  return "powershell";
}

// --------------------------------------------------------------------- quoting

/** POSIX single-quote: embedded quotes become `'\''`. */
export function quotePosix(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** PowerShell single-quote: embedded quotes double. Variables stay literal. */
export function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * cmd.exe argument quoting.
 *
 * Double quotes are the only grouping cmd understands; an embedded quote is
 * doubled for the C runtime the shim is written in. `%` is left alone on
 * purpose: cmd expands `%VAR%` even inside quotes, and `%%` escaping only works
 * in batch files. Paths containing `%` are pathological; everything else is
 * covered.
 */
export function quoteCmd(value: string): string {
  if (!/[\s"&<>|^()]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

export function shellQuoteFor(shell: ShellKind, value: string): string {
  if (shell === "cmd") return quoteCmd(value);
  if (shell === "powershell") return quotePowerShell(value);
  return quotePosix(value);
}

/** Quote a whole command line for a shell dialect (display / clipboard use). */
export function quoteCommandLineFor(shell: ShellKind, command: string, args: readonly string[]): string {
  return [command, ...args].map((part) => shellQuoteFor(shell, part)).join(" ");
}

// ---------------------------------------------------------------- path identity

/**
 * Canonical form for comparing two paths.
 *
 * win32: lowercase, unified separators, no trailing separator, no `\\?\` prefix.
 * POSIX: separators collapsed and trailing separator removed.
 */
export function normalizePathForCompare(value: string, platform: PlatformName = process.platform): string {
  const api = pathApiFor(platform);
  let normalized = api.normalize(value);
  if (platform === "win32") {
    normalized = normalized.replace(/^\\\\\?\\/, "");
    // `C:` alone means "current directory on C:", so keep the separator on roots.
    const root = api.parse(normalized).root;
    if (normalized.length > root.length) {
      normalized = normalized.replace(/[\\/]+$/, "");
    }
    return normalized.toLowerCase();
  }
  if (normalized.length > 1) {
    normalized = normalized.replace(/\/+$/, "");
  }
  return normalized;
}

export function samePath(
  a: string,
  b: string,
  platform: PlatformName = process.platform
): boolean {
  return normalizePathForCompare(a, platform) === normalizePathForCompare(b, platform);
}

/**
 * True when `target` is `root` or lives inside it.
 *
 * Replaces `target.startsWith(root + sep)`, which is wrong on Windows twice
 * over: the comparison is case-insensitive, and a sibling named `repo-2` must
 * not count as inside `repo`.
 */
export function isPathInside(
  root: string,
  target: string,
  platform: PlatformName = process.platform
): boolean {
  const api = pathApiFor(platform);
  const normalizedRoot = normalizePathForCompare(root, platform);
  const normalizedTarget = normalizePathForCompare(target, platform);
  if (normalizedRoot === normalizedTarget) return true;
  const relative = api.relative(normalizedRoot, normalizedTarget);
  return Boolean(relative) && !relative.startsWith("..") && !api.isAbsolute(relative);
}

// ------------------------------------------------------------------- env / names

/**
 * Expand `%NAME%` (Windows only) and `${NAME}` (everywhere) from `env`.
 * Unknown variables are left verbatim so a typo is visible instead of becoming
 * an empty path.
 */
export function expandEnvVars(
  input: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: PlatformName = process.platform
): string {
  let out = input;
  if (platform === "win32") {
    out = out.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (whole, name: string) => {
      const value = env[name] ?? env[name.toUpperCase()] ?? env[name.toLowerCase()];
      return value ?? whole;
    });
  }
  out = out.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (whole, name: string) => env[name] ?? whole);
  return out;
}

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** `CON`, `nul.txt`, `COM1` … cannot be created on Windows whatever the folder. */
export function isWindowsReservedName(name: string): boolean {
  const stem = name.split(".")[0]?.trim() ?? "";
  return WINDOWS_RESERVED_NAME.test(stem);
}

/** Append `-` to a reserved device name so it can be written on Windows. */
export function avoidWindowsReservedName(name: string): string {
  if (!isWindowsReservedName(name)) return name;
  const dot = name.indexOf(".");
  return dot > 0 ? `${name.slice(0, dot)}-${name.slice(dot)}` : `${name}-`;
}
