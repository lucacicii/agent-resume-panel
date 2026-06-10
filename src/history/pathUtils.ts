import * as os from "node:os";
import * as path from "node:path";

export function expandHome(input: string): string {
  if (input === "~") {
    return os.homedir();
  }

  if (input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }

  return input;
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
