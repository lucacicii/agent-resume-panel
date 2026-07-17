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

export function compactPath(projectPath: string): string {
  const home = os.homedir();
  if (projectPath === home) {
    return "~";
  }

  if (projectPath.startsWith(`${home}${path.sep}`)) {
    return `~/${path.relative(home, projectPath)}`;
  }

  return projectPath;
}
