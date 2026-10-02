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
  /** Ready-to-spawn binary (thunder-daemon / thunder-tui), if one was found. */
  binaryPath: string | null;
  /** Fallback build script (daemon.sh / run.sh) when no binary exists. */
  scriptPath: string | null;
  source: ThunderDaemonSource;
  /** Every path probed, in order, so "why didn't it find my build?" is answerable. */
  candidates: string[];
  /** Binary this location describes; drives the diagnostic wording. */
  binaryName: string;
}

export interface ThunderDaemonSettings {
  repoPath?: string;
  daemonPath?: string;
  /** Explicit `thunder-tui` binary for the TUI new-session target. */
  tuiPath?: string;
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
  // Unified workspace: the whole monorepo builds into `<repo>/target/{release,debug}`.
  path.join("target", "release", "thunder-daemon"),
  path.join("target", "debug", "thunder-daemon"),
  // Legacy per-crate layout (pre-workspace-unification checkouts).
  path.join("thunder-agent-daemon", "target", "release", "thunder-daemon"),
  path.join("thunder-agent-daemon", "target", "debug", "thunder-daemon"),
  // Bundled layout: `Contents/Resources/thunder/bin/thunder-daemon`.
  path.join("bin", "thunder-daemon"),
  "thunder-daemon"
];

/** TUI binary paths. The TUI crate nests under `thunder-agent-core/tui` in the monorepo. */
const REPO_TUI_BINARY_RELATIVE_PATHS = [
  path.join("target", "release", "thunder-tui"),
  path.join("target", "debug", "thunder-tui"),
  path.join("thunder-agent-core", "tui", "target", "release", "thunder-tui"),
  path.join("thunder-agent-core", "tui", "target", "debug", "thunder-tui"),
  path.join("bin", "thunder-tui"),
  "thunder-tui"
];

const REPO_SCRIPT_RELATIVE_PATH = "daemon.sh";
const REPO_TUI_SCRIPT_RELATIVE_PATH = "run.sh";

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

/** Which Thunder binary a resolution targets, plus its on-disk layout. */
interface ThunderBinarySpec {
  binaryName: string;
  binaryRelativePaths: string[];
  scriptRelativePath: string;
  envBinVar: string;
  settingsBinKey: "daemonPath" | "tuiPath";
}

const DAEMON_SPEC: ThunderBinarySpec = {
  binaryName: "thunder-daemon",
  binaryRelativePaths: REPO_BINARY_RELATIVE_PATHS,
  scriptRelativePath: REPO_SCRIPT_RELATIVE_PATH,
  envBinVar: "THUNDER_DAEMON_BIN",
  settingsBinKey: "daemonPath"
};

const TUI_SPEC: ThunderBinarySpec = {
  binaryName: "thunder-tui",
  binaryRelativePaths: REPO_TUI_BINARY_RELATIVE_PATHS,
  scriptRelativePath: REPO_TUI_SCRIPT_RELATIVE_PATH,
  envBinVar: "THUNDER_TUI_BIN",
  settingsBinKey: "tuiPath"
};

function binaryInRepo(
  repo: string,
  exists: (p: string) => boolean,
  spec: ThunderBinarySpec
): DaemonInRepo | null {
  for (const relative of spec.binaryRelativePaths) {
    const binaryPath = path.join(repo, relative);
    if (exists(binaryPath)) {
      const scriptPath = path.join(repo, spec.scriptRelativePath);
      return { binaryPath, scriptPath: exists(scriptPath) ? scriptPath : null };
    }
  }

  const scriptPath = path.join(repo, spec.scriptRelativePath);
  if (exists(scriptPath)) {
    return { binaryPath: null, scriptPath };
  }

  return null;
}

/**
 * Derive the checkout root from a direct binary path so `repoPath` stays useful.
 * `<repo>/target/release/thunder-daemon` → `<repo>` (unified workspace),
 * `<repo>/thunder-agent-daemon/target/release/thunder-daemon` → `<repo>` (legacy).
 * Anything else falls back to the binary's own directory.
 */
export function repoRootForBinary(binaryPath: string): string {
  const parts = path.normalize(binaryPath).split(path.sep);
  const name = parts.at(-1);
  const isCargoTarget =
    (name === "thunder-daemon" || name === "thunder-tui") &&
    parts.at(-3) === "target" &&
    (parts.at(-2) === "release" || parts.at(-2) === "debug");
  if (isCargoTarget) {
    // Legacy layout nests the crate dir; unified layout has the repo directly above `target`.
    const crateDir = parts.at(-4);
    if (crateDir === "thunder-agent-daemon") return parts.slice(0, -4).join(path.sep) || path.sep;
    if (crateDir === "tui") return parts.slice(0, -5).join(path.sep) || path.sep;
    return parts.slice(0, -3).join(path.sep) || path.sep;
  }
  return path.dirname(binaryPath);
}

function scriptNextToBinary(
  binaryPath: string,
  exists: (p: string) => boolean,
  spec: ThunderBinarySpec
): string | null {
  const scriptPath = path.join(repoRootForBinary(binaryPath), spec.scriptRelativePath);
  return exists(scriptPath) ? scriptPath : null;
}

/**
 * Resolve the daemon location from highest- to lowest-priority rule:
 * explicit binary → explicit repo → bundled → dev sibling → cwd → `$HOME` guesses.
 */
function resolveThunderBinary(
  spec: ThunderBinarySpec,
  options: ResolveThunderDaemonOptions = {}
): ThunderDaemonLocation {
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
    candidates,
    binaryName: spec.binaryName
  });

  // 1. Explicit binaries beat any layout guessing.
  const explicitBinaries: Array<{ value: string | undefined; source: ThunderDaemonSource }> = [
    { value: env[spec.envBinVar]?.trim(), source: "env-daemon-bin" },
    { value: options.settings?.[spec.settingsBinKey]?.trim(), source: "settings-daemon-path" }
  ];
  for (const { value, source } of explicitBinaries) {
    if (!value) continue;
    if (probe(value)) {
      return build(source, repoRootForBinary(value), {
        binaryPath: value,
        scriptPath: scriptNextToBinary(value, exists, spec)
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

  // A directory that exists but holds neither binary nor the build script is only
  // a last resort: keep scanning so a runnable copy later in the list still wins.
  let emptyRepo: string | null = null;
  for (const { dir, source } of repos) {
    if (!probe(dir)) continue;
    const found = binaryInRepo(dir, exists, spec);
    if (found) return build(source, dir, found);
    emptyRepo = emptyRepo ?? dir;
  }

  return {
    repoPath: emptyRepo,
    binaryPath: null,
    scriptPath: null,
    source: "none",
    candidates,
    binaryName: spec.binaryName
  };
}

/**
 * Locate the Thunder daemon binary (`thunder-daemon`).
 * Rules: explicit bin → explicit repo → bundled → dev sibling → cwd → `$HOME` guesses.
 */
export function resolveThunderDaemon(options: ResolveThunderDaemonOptions = {}): ThunderDaemonLocation {
  return resolveThunderBinary(DAEMON_SPEC, options);
}

/**
 * Locate the Thunder TUI binary (`thunder-tui`) with the same discovery rules, so a
 * checkout that runs the daemon can also run the interactive terminal client.
 */
export function resolveThunderTui(options: ResolveThunderDaemonOptions = {}): ThunderDaemonLocation {
  return resolveThunderBinary(TUI_SPEC, options);
}

/** One-line diagnostic for logs / error messages. */
export function describeThunderResolution(location: ThunderDaemonLocation): string {
  const name = location.binaryName || "thunder-daemon";
  if (location.binaryPath || location.scriptPath) {
    return `source=${location.source} ${name}=${location.binaryPath || location.scriptPath} repo=${location.repoPath ?? "-"}`;
  }
  if (location.repoPath) {
    return `source=none repo=${location.repoPath} (no ${name} binary or build script inside)`;
  }
  return `source=none probed=${location.candidates.length} paths: ${location.candidates.join(", ")}`;
}
