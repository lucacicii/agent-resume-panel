import * as os from "node:os";
import * as path from "node:path";

export function expandHome(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return trimmed;
  }

  if (trimmed === "~") {
    return os.homedir();
  }

  if (trimmed.startsWith("~/")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }

  if (trimmed.startsWith("$HOME/")) {
    return path.join(os.homedir(), trimmed.slice("$HOME/".length));
  }

  return rehomeForeignAbsolutePath(path.normalize(trimmed));
}

function rehomeForeignAbsolutePath(input: string): string {
  const home = os.homedir();
  if (!path.isAbsolute(input) || input === home || input.startsWith(`${home}${path.sep}`)) {
    return input;
  }

  const foreignHomePattern = process.platform === "win32"
    ? null
    : process.platform === "darwin"
      ? /^\/Users\/([^/]+)(?:\/(.*))?$/
      : /^\/home\/([^/]+)(?:\/(.*))?$/;
  if (!foreignHomePattern) {
    return input;
  }

  const match = input.match(foreignHomePattern);
  if (!match || match[1] === path.basename(home)) {
    return input;
  }

  const suffix = match[2] ?? "";
  return suffix ? path.join(home, suffix) : home;
}

export function basenameOrPath(projectPath: string): string {
  const normalized = path.normalize(projectPath);
  const base = path.basename(normalized);
  return base || normalized;
}

export function normalizeProjectPath(projectPath: string): string {
  return path.resolve(projectPath);
}

export function compactPath(projectPath: string): string {
  const home = os.homedir();
  if (projectPath === home) {
    return "~";
  }

  if (projectPath.startsWith(`${home}${path.sep}`)) {
    return `~/${path.relative(home, projectPath).split(path.sep).join("/")}`;
  }

  return projectPath;
}

/**
 * Cross-machine project identity key.
 * Paths under the current home (or a rehomed foreign home) become `~/…`;
 * otherwise `abs:…`.
 */
export function toPortableKey(projectPath: string): string {
  const trimmed = projectPath?.trim() || "";
  if (!trimmed) {
    return "abs:";
  }
  if (trimmed === "~" || trimmed.startsWith("~/") || trimmed.startsWith("$HOME/")) {
    const expanded = expandHome(trimmed);
    return compactPath(normalizeProjectPath(expanded));
  }
  const normalized = normalizeProjectPath(trimmed);
  const rehomed = expandHome(normalized);
  const compact = compactPath(rehomed);
  if (compact === "~" || compact.startsWith("~/")) {
    return compact;
  }
  // Try foreign-home compact without requiring path to exist on this machine.
  const foreignCompact = compactForeignAbsolutePath(normalized);
  if (foreignCompact) {
    return foreignCompact;
  }
  return `abs:${normalized.split(path.sep).join("/")}`;
}

/** Expand `~/…` / `$HOME/…` portable keys; leave `abs:…` as absolute paths. */
export function expandPortableKey(portableKey: string): string {
  const key = portableKey?.trim() || "";
  if (!key) {
    return os.homedir();
  }
  if (key.startsWith("abs:")) {
    return key.slice("abs:".length) || os.homedir();
  }
  return expandHome(key);
}

/**
 * True when path is under another user's home (e.g. /Users/alice/… on bob's machine).
 * Useful for UI badges: session indexed from another machine.
 */
export function isForeignUserPath(projectPath: string): boolean {
  const trimmed = projectPath?.trim() || "";
  if (!trimmed || trimmed.startsWith("~") || trimmed.startsWith("$HOME")) {
    return false;
  }
  if (!path.isAbsolute(trimmed)) {
    return false;
  }
  const normalized = path.normalize(trimmed);
  const home = os.homedir();
  if (normalized === home || normalized.startsWith(`${home}${path.sep}`)) {
    return false;
  }
  return expandHome(normalized) !== normalized;
}

function compactForeignAbsolutePath(absolutePath: string): string | null {
  if (!path.isAbsolute(absolutePath)) {
    return null;
  }
  const foreignHomePattern =
    process.platform === "win32"
      ? null
      : process.platform === "darwin"
        ? /^\/Users\/([^/]+)(?:\/(.*))?$/
        : /^\/home\/([^/]+)(?:\/(.*))?$/;
  if (!foreignHomePattern) {
    return null;
  }
  const match = absolutePath.match(foreignHomePattern);
  if (!match) {
    return null;
  }
  const suffix = (match[2] ?? "").split(path.sep).join("/");
  return suffix ? `~/${suffix}` : "~";
}
