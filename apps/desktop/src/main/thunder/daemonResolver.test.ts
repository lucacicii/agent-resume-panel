import { describe, expect, it } from "vitest";
import * as path from "node:path";
import { describeThunderResolution, repoRootForBinary, resolveThunderDaemon } from "./daemonResolver";

/**
 * Path discovery used to be inline in `thunderClient` with zero tests, and it silently
 * broke when the thunder checkout moved. These cases pin the rules:
 * explicit > settings > bundled > dev sibling > cwd > $HOME guesses.
 */

const HOME = "/Users/tester";
const MODULE_DIR = "/Users/tester/wz/agent-resume-panel/apps/desktop/dist/main/thunder";
const SIBLING_REPO = "/Users/tester/wz/thunder";

/** Virtual filesystem probe: a candidate exists when it is a known file or an ancestor of one. */
function probe(paths: string[]): (candidate: string) => boolean {
  const files = new Set(paths.map((p) => path.normalize(p)));
  const dirs = new Set<string>();
  for (const file of files) {
    let dir = path.dirname(file);
    while (dir !== path.dirname(dir) && !dirs.has(dir)) {
      dirs.add(dir);
      dir = path.dirname(dir);
    }
  }
  return (candidate) => {
    const normalized = path.normalize(candidate);
    return files.has(normalized) || dirs.has(normalized);
  };
}

function resolve(overrides: Partial<Parameters<typeof resolveThunderDaemon>[0]> & { paths?: string[] } = {}) {
  const { paths = [], ...rest } = overrides;
  return resolveThunderDaemon({
    env: {},
    moduleDir: MODULE_DIR,
    cwd: "/",
    homedir: HOME,
    exists: probe(paths),
    ...rest
  });
}

const RELEASE_BIN = path.join(SIBLING_REPO, "thunder-agent-daemon/target/release/thunder-daemon");
const DEBUG_BIN = path.join(SIBLING_REPO, "thunder-agent-daemon/target/debug/thunder-daemon");
const SCRIPT = path.join(SIBLING_REPO, "daemon.sh");

describe("resolveThunderDaemon", () => {
  it("uses THUNDER_DAEMON_BIN first and derives the checkout root from a cargo target path", () => {
    const location = resolve({ env: { THUNDER_DAEMON_BIN: RELEASE_BIN }, paths: [RELEASE_BIN, SCRIPT] });

    expect(location.source).toBe("env-daemon-bin");
    expect(location.binaryPath).toBe(RELEASE_BIN);
    expect(location.repoPath).toBe(SIBLING_REPO);
    expect(location.scriptPath).toBe(SCRIPT);
  });

  it("falls through a missing THUNDER_DAEMON_BIN instead of failing", () => {
    const location = resolve({
      env: { THUNDER_DAEMON_BIN: "/nope/thunder-daemon" },
      paths: [RELEASE_BIN, SCRIPT]
    });

    expect(location.source).toBe("dev-sibling");
    expect(location.binaryPath).toBe(RELEASE_BIN);
  });

  it("prefers THUNDER_PATH over layout probing", () => {
    const otherRepo = "/opt/checkouts/thunder";
    const otherBin = path.join(otherRepo, "thunder-agent-daemon/target/debug/thunder-daemon");
    const location = resolve({
      env: { THUNDER_PATH: otherRepo },
      paths: [otherBin, RELEASE_BIN]
    });

    expect(location.source).toBe("env-repo-path");
    expect(location.repoPath).toBe(otherRepo);
    expect(location.binaryPath).toBe(otherBin);
  });

  it("honours settings.thunder.daemonPath then settings.thunder.repoPath", () => {
    const directBin = "/opt/my-thunder/thunder-daemon";
    const withBin = resolve({
      settings: { daemonPath: directBin, repoPath: SIBLING_REPO },
      paths: [directBin, RELEASE_BIN]
    });
    expect(withBin.source).toBe("settings-daemon-path");
    expect(withBin.binaryPath).toBe(directBin);

    const withRepo = resolve({ settings: { repoPath: SIBLING_REPO }, paths: [RELEASE_BIN, SCRIPT] });
    expect(withRepo.source).toBe("settings-repo-path");
    expect(withRepo.binaryPath).toBe(RELEASE_BIN);
  });

  it("finds a bundled daemon under process.resourcesPath", () => {
    const resources = "/Applications/Agent Resume.app/Contents/Resources";
    const bundled = path.join(resources, "thunder/bin/thunder-daemon");
    const location = resolve({ resourcesPath: resources, paths: [bundled] });

    expect(location.source).toBe("bundled");
    expect(location.binaryPath).toBe(bundled);
    expect(location.repoPath).toBe(path.join(resources, "thunder/bin"));
  });

  it("finds the sibling checkout of this repo in a dev run", () => {
    const location = resolve({ paths: [RELEASE_BIN, SCRIPT] });

    expect(location.source).toBe("dev-sibling");
    expect(location.repoPath).toBe(SIBLING_REPO);
  });

  it("probes $HOME checkouts so a locally built daemon is found from a packaged app", () => {
    const localBin = path.join(HOME, "GitHub/thunder/thunder-agent-daemon/target/release/thunder-daemon");
    const location = resolve({ cwd: "/", paths: [localBin] });

    expect(location.source).toBe("local-checkout");
    expect(location.repoPath).toBe(path.join(HOME, "GitHub/thunder"));
    expect(location.binaryPath).toBe(localBin);
  });

  it("never probes a hardcoded absolute user path", () => {
    const { candidates } = resolve();

    expect(candidates.some((candidate) => candidate.startsWith("/Users/lucas"))).toBe(false);
  });

  it("prefers release over debug inside one checkout", () => {
    const location = resolve({ paths: [DEBUG_BIN, RELEASE_BIN, SCRIPT] });

    expect(location.binaryPath).toBe(RELEASE_BIN);
  });

  it("falls back to daemon.sh when no binary is built", () => {
    const location = resolve({ paths: [SCRIPT] });

    expect(location.binaryPath).toBeNull();
    expect(location.scriptPath).toBe(SCRIPT);
    expect(location.repoPath).toBe(SIBLING_REPO);
  });

  it("keeps scanning when a checkout exists but is not built yet", () => {
    // Regression: an empty `thunder` dir used to win and mask a runnable copy below it.
    const location = resolve({ paths: [SIBLING_REPO, RELEASE_BIN] });

    expect(location.binaryPath).toBe(RELEASE_BIN);
    expect(location.source).toBe("dev-sibling");
  });

  it("reports the empty checkout when nothing is runnable anywhere", () => {
    const location = resolve({ paths: [SIBLING_REPO] });

    expect(location.binaryPath).toBeNull();
    expect(location.scriptPath).toBeNull();
    expect(location.repoPath).toBe(SIBLING_REPO);
    expect(describeThunderResolution(location)).toContain("no thunder-daemon binary");
  });

  it("returns source=none with the probed paths when nothing exists", () => {
    const location = resolve();

    expect(location).toMatchObject({ source: "none", repoPath: null, binaryPath: null, scriptPath: null });
    expect(location.candidates.length).toBeGreaterThan(0);
    expect(describeThunderResolution(location)).toContain("probed=");
  });
});

describe("repoRootForBinary", () => {
  it("strips the cargo target path", () => {
    expect(repoRootForBinary("/w/thunder/thunder-agent-daemon/target/release/thunder-daemon")).toBe("/w/thunder");
    expect(repoRootForBinary("/w/thunder/thunder-agent-daemon/target/debug/thunder-daemon")).toBe("/w/thunder");
  });

  it("falls back to the parent directory for arbitrary layouts", () => {
    expect(repoRootForBinary("/Applications/X.app/Contents/Resources/thunder/bin/thunder-daemon")).toBe(
      "/Applications/X.app/Contents/Resources/thunder/bin"
    );
  });
});
