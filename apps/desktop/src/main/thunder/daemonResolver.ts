import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Locating the Thunder daemon.
 *
 * Thunder is a separate Rust workspace (`thunder` / `thunder-agent-daemon`), so the
 * desktop app has to find a binary it does not own. Layouts differ per environment:
 *
 * | Environment       | Where the daemon lives                                          |
 * | ----------------- | --------------------------------------------------------------- |
 * | developer machine | sibling checkout: `<panel repo>/../thunder`                      |
 * | local test build  | user's own checkout (`~/wz/thunder`, `~/GitHub/thunder`, …)      |
 * | packaged app      | bundled at `Contents/Resources/thunder/bin/thunder-daemon`       |
 * | CI / power users  | explicit `THUNDER_PATH` / `THUNDER_DAEMON_BIN` or settings       |
 *
 * Keeping this a pure function (injected env + `exists`) is deliberate: path
 * discovery is the part that silently rots, and it must be unit-testable without
 * a filesystem or a running Electron app.
 */

/** Which rule produced the result — surfaced in logs, `thunder:status` and doctor output. */
export type ThunderDaemonSource =
  | "env-daemon-bin"
  | "settings-daemon-path"
  | "env-repo-path"
  | "settings-repo-path"
  | "bundled"
  | "dev-sibling"
  | "cwd-relative"
  | "local-checkout"
  | "none";

export interface ThunderDaemonLocation {
  /** Thunder workspace root, when one was identified (informational: UI + logs). */
  repoPath: string | null;
  /** Ready-to-spawn `thunder-daemon` binary, if one was found. */
  binaryPath: string | null;
  /** Fallback `daemon.sh` (builds on demand via cargo) when no binary exists. */
  scriptPath: string | null;
  source: ThunderDaemonSource;
  /** Every path probed, in order, so "why didn't it find my build?" is answerable. */
  candidates: string[];
}

export interface ThunderDaemonSettings {
  repoPath?: string;
  daemonPath?: string;
}

export interface ResolveThunderDaemonOptions {
  env?: NodeJS.ProcessEnv;
  /** `__dirname` of the calling module — i.e. `<app>/dist/main/thunder`. */
  moduleDir?: string;
  cwd?: string;
  homedir?: string;
  /** Packaged app's `process.resourcesPath`; the bundled daemon lives in `thunder/bin`. */
  resourcesPath?: string;
  settings?: ThunderDaemonSettings | null;
  /** Injectable filesystem probe (tests pass a set of paths). */
  exists?: (candidate: string) => boolean;
}

/** Daemon binary paths relative to a thunder checkout root. */
const REPO_BINARY_RELATIVE_PATHS = [
  path.join("thunder-agent-daemon", "target", "release", "thunder-daemon"),
  path.join("thunder-agent-daemon", "target", "debug", "thunder-daemon"),
  // Bundled layout: `Contents/Resources/thunder/bin/thunder-daemon`.
  path.join("bin", "thunder-daemon"),
  "thunder-daemon"
];

const REPO_SCRIPT_RELATIVE_PATH = "daemon.sh";

/** Subdirectories of a packaged app's `Resources/` that may hold a bundled daemon. */
const BUNDLED_RESOURCE_DIRS = [path.join("thunder", "bin"), "thunder"];

/**
 * Checkout locations probed under `$HOME`. These are convenience guesses for people
 * who built thunder themselves; nothing here is a hardcoded absolute user path.
 */
const LOCAL_CHECKOUT_DIRS = [
  "wz/thunder",
  "wz/GitHub/thunder",
  "GitHub/thunder",
  "Documents/GitHub/thunder",
  "thunder"
];

interface RepoCandidate {
  dir: string;
  source: ThunderDaemonSource;
}

interface DaemonInRepo {
  binaryPath: string | null;
  scriptPath: string | null;
}

function daemonInRepo(repo: string, exists: (p: string) => boolean): DaemonInRepo | null {
  for (const relative of REPO_BINARY_RELATIVE_PATHS) {
    const binaryPath = path.join(repo, relative);
    if (exists(binaryPath)) {
      const scriptPath = path.join(repo, REPO_SCRIPT_RELATIVE_PATH);
      return { binaryPath, scriptPath: exists(scriptPath) ? scriptPath : null };
    }
  }

  const scriptPath = path.join(repo, REPO_SCRIPT_RELATIVE_PATH);
  if (exists(scriptPath)) {
    return { binaryPath: null, scriptPath };
  }

  return null;
}

/**
 * Derive the checkout root from a direct binary path so `repoPath` stays useful.
 * `<repo>/thunder-agent-daemon/target/release/thunder-daemon` → `<repo>`.
 */
export function repoRootForBinary(binaryPath: string): string {
  const parts = path.normalize(binaryPath).split(path.sep);
  const isCargoTarget =
    parts.at(-1) === "thunder-daemon" &&
    parts.at(-3) === "target" &&
    parts.at(-4) === "thunder-agent-daemon";
  if (isCargoTarget) return parts.slice(0, -4).join(path.sep) || path.sep;
  return path.dirname(binaryPath);
}

function scriptNextToBinary(binaryPath: string, exists: (p: string) => boolean): string | null {
  const scriptPath = path.join(repoRootForBinary(binaryPath), REPO_SCRIPT_RELATIVE_PATH);
  return exists(scriptPath) ? scriptPath : null;
}

/**
 * Resolve the daemon location from highest- to lowest-priority rule:
 * explicit binary → explicit repo → bundled → dev sibling → cwd → `$HOME` guesses.
 */
export function resolveThunderDaemon(options: ResolveThunderDaemonOptions = {}): ThunderDaemonLocation {
  const env = options.env ?? process.env;
  const exists = options.exists ?? fs.existsSync;
  const homedir = options.homedir ?? os.homedir();
  const moduleDir = options.moduleDir ?? __dirname;
  const cwd = options.cwd ?? process.cwd();

  const candidates: string[] = [];
  const probe = (candidate: string): boolean => {
    candidates.push(candidate);
    return exists(candidate);
  };

  const build = (
    source: ThunderDaemonSource,
    repoPath: string | null,
    found: DaemonInRepo
  ): ThunderDaemonLocation => ({
    repoPath,
    binaryPath: found.binaryPath,
    scriptPath: found.scriptPath,
    source,
    candidates
  });

  // 1. Explicit binaries beat any layout guessing.
  const explicitBinaries: Array<{ value: string | undefined; source: ThunderDaemonSource }> = [
    { value: env.THUNDER_DAEMON_BIN?.trim(), source: "env-daemon-bin" },
    { value: options.settings?.daemonPath?.trim(), source: "settings-daemon-path" }
  ];
  for (const { value, source } of explicitBinaries) {
    if (!value) continue;
    if (probe(value)) {
      return build(source, repoRootForBinary(value), {
        binaryPath: value,
        scriptPath: scriptNextToBinary(value, exists)
      });
    }
  }

  // 2. Candidate repo/daemon directories, in priority order.
  const repos: RepoCandidate[] = [];
  const pushRepo = (dir: string | undefined, source: ThunderDaemonSource): void => {
    const trimmed = dir?.trim();
    if (trimmed) repos.push({ dir: trimmed, source });
  };

  pushRepo(env.THUNDER_PATH, "env-repo-path");
  pushRepo(options.settings?.repoPath, "settings-repo-path");

  if (options.resourcesPath?.trim()) {
    for (const relative of BUNDLED_RESOURCE_DIRS) {
      pushRepo(path.join(options.resourcesPath.trim(), relative), "bundled");
    }
  }

  // Dev checkout: `<parent of this repo>/thunder` (dist/main/thunder → repo root is 6 up).
  pushRepo(path.resolve(moduleDir, "../../../../../../thunder"), "dev-sibling");
  pushRepo(path.resolve(cwd, "../thunder"), "cwd-relative");
  pushRepo(path.resolve(cwd, "../../thunder"), "cwd-relative");
  pushRepo(path.resolve(cwd, "thunder"), "cwd-relative");

  for (const relative of LOCAL_CHECKOUT_DIRS) {
    pushRepo(path.join(homedir, relative), "local-checkout");
  }

  // A directory that exists but holds neither binary nor daemon.sh is only a last
  // resort: keep scanning so a runnable copy later in the list still wins.
  let emptyRepo: string | null = null;
  for (const { dir, source } of repos) {
    if (!probe(dir)) continue;
    const found = daemonInRepo(dir, exists);
    if (found) return build(source, dir, found);
    emptyRepo = emptyRepo ?? dir;
  }

  return {
    repoPath: emptyRepo,
    binaryPath: null,
    scriptPath: null,
    source: "none",
    candidates
  };
}

/** One-line diagnostic for logs / error messages. */
export function describeThunderResolution(location: ThunderDaemonLocation): string {
  if (location.binaryPath || location.scriptPath) {
    return `source=${location.source} daemon=${location.binaryPath || location.scriptPath} repo=${location.repoPath ?? "-"}`;
  }
  if (location.repoPath) {
    return `source=none repo=${location.repoPath} (no thunder-daemon binary or daemon.sh inside)`;
  }
  return `source=none probed=${location.candidates.length} paths: ${location.candidates.join(", ")}`;
}
