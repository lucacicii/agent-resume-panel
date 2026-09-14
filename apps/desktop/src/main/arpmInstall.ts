import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import * as path from "node:path";

const MANAGED_MARKER = "installed by Agent Resume; managed file";

export function defaultArpmBinDir(): string {
  return path.join(homedir(), ".local", "bin");
}

export function arpmShimPath(binDir = defaultArpmBinDir()): string {
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

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
