import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/**
 * Thunder daemon sidecar for packaged builds.
 *
 * Thunder is a separate Rust repo, so a DMG only works out of the box if we put a
 * `thunder-daemon` binary *inside* the app bundle. That is this module's whole job:
 * find or build one per architecture, stage it as
 *
 *   apps/desktop/.thunder-sidecar/<arch>/thunder/bin/thunder-daemon
 *
 * and hand the `thunder` directory to electron-packager's `extraResource`, which
 * lands at `Contents/Resources/thunder/...` — exactly where the runtime resolver
 * (`src/main/thunder/daemonResolver.ts`, source `bundled`) looks for it.
 *
 * The binary is architecture-specific, so each arch is built/copied separately:
 * x64 → `x86_64-apple-darwin`, arm64 → `aarch64-apple-darwin` (cross builds need
 * `rustup target add <triple>`).
 */

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.join(root, "..", "..");
const sidecarRoot = path.join(root, ".thunder-sidecar");

export const THUNDER_TARGETS = {
  darwin: { x64: "x86_64-apple-darwin", arm64: "aarch64-apple-darwin" },
  win32: { x64: "x86_64-pc-windows-msvc", arm64: "aarch64-pc-windows-msvc" }
};
export const THUNDER_DAEMON_BIN = "thunder-daemon";
export const THUNDER_TUI_BIN = "thunder-tui";

/** Windows binaries carry an extension; the staged file name must match. */
export function thunderBinaryName(base, platform = process.platform) {
  return platform === "win32" ? `${base}.exe` : base;
}

export function thunderTargetFor(arch, platform = process.platform) {
  return THUNDER_TARGETS[platform]?.[arch] ?? null;
}

/** Relative layout inside the bundle: `Contents/Resources/thunder` + `bin/thunder-daemon`. */
const RESOURCE_DIR_NAME = "thunder";
const BUNDLE_SUBDIR = ["bin"];

export function hostTarget(platform = process.platform) {
  return thunderTargetFor(process.arch, platform);
}

/**
 * Staging root for one arch and platform
 * (`apps/desktop/.thunder-sidecar/<platform>-<arch>`). The platform is part of
 * the path so a Windows pack never overwrites a macOS staging directory.
 */
export function sidecarDir(arch, platform = process.platform) {
  return path.join(sidecarRoot, `${platform}-${arch}`);
}

/** Directory handed to electron-packager's `extraResource` (becomes `Resources/thunder`). */
export function sidecarResourceDir(arch, platform = process.platform) {
  return path.join(sidecarDir(arch, platform), RESOURCE_DIR_NAME);
}

export function stagedBinaryPath(arch, platform = process.platform) {
  return path.join(sidecarResourceDir(arch, platform), ...BUNDLE_SUBDIR, thunderBinaryName(THUNDER_DAEMON_BIN, platform));
}

/** Where the bundled `thunder-tui` binary lands (beside the daemon). */
export function stagedTuiBinaryPath(arch, platform = process.platform) {
  return path.join(sidecarResourceDir(arch, platform), ...BUNDLE_SUBDIR, thunderBinaryName(THUNDER_TUI_BIN, platform));
}

/**
 * Where the daemon must end up inside a packaged app.
 *
 * macOS: `<app>.app/Contents/Resources/thunder/bin/…`
 * Windows/Linux: `<app>/resources/thunder/bin/…`
 */
export function bundledResourceRoot(appRoot, platform = process.platform) {
  return platform === "darwin"
    ? path.join(appRoot, "Contents", "Resources", RESOURCE_DIR_NAME)
    : path.join(appRoot, "resources", RESOURCE_DIR_NAME);
}

export function bundledDaemonPath(appRoot, platform = process.platform) {
  return path.join(bundledResourceRoot(appRoot, platform), ...BUNDLE_SUBDIR, thunderBinaryName(THUNDER_DAEMON_BIN, platform));
}

/** Where the TUI must end up inside a packaged app (beside the daemon). */
export function bundledTuiPath(appRoot, platform = process.platform) {
  return path.join(bundledResourceRoot(appRoot, platform), ...BUNDLE_SUBDIR, thunderBinaryName(THUNDER_TUI_BIN, platform));
}

/** Fallback checkout probe used only when the compiled runtime resolver is unavailable. */
function fallbackCheckouts(env, homedir) {
  return [
    env.THUNDER_PATH,
    path.resolve(repoRoot, "..", "thunder"),
    path.join(homedir, "wz/thunder"),
    path.join(homedir, "GitHub/thunder"),
    path.join(homedir, "Documents/GitHub/thunder")
  ].filter((candidate) => typeof candidate === "string" && candidate.trim().length > 0);
}

/**
 * Locate a thunder checkout the same way the app does at runtime, so pack-time and
 * run-time never disagree. Uses the compiled resolver when present.
 */
export function findThunderCheckout({ env = process.env, homedir = os.homedir(), exists = fs.existsSync, log } = {}) {
  if (env.THUNDER_PATH && exists(env.THUNDER_PATH)) return env.THUNDER_PATH.trim();

  const resolverPath = path.join(root, "dist", "main", "thunder", "daemonResolver.js");
  if (exists(resolverPath)) {
    try {
      const require = createRequire(import.meta.url);
      const { resolveThunderDaemon } = require(resolverPath);
      const location = resolveThunderDaemon({ settings: null, env });
      if (location?.repoPath) return location.repoPath;
    } catch (error) {
      log?.(`[thunder-sidecar] Compiled resolver unavailable (${error.message}); falling back to path probes.`);
    }
  }

  for (const candidate of fallbackCheckouts(env, homedir)) {
    if (exists(candidate)) return candidate;
  }
  return null;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/**
 * Find or build a `thunder-daemon` for `arch`.
 *
 * Priority: explicit binary → prebuilt artifact dir → `cargo build --release` from a
 * checkout. Nothing found returns `ok: false` so callers can pick warn-vs-fail.
 */
export function resolveThunderBinary({
  arch,
  platform = process.platform,
  env = process.env,
  hostArch = process.arch,
  homedir = os.homedir(),
  exists = fs.existsSync,
  runCargo,
  findCheckout = findThunderCheckout,
  log = console.log
}) {
  const target = thunderTargetFor(arch, platform);
  if (!target) return { ok: false, reason: `unsupported arch "${arch}" for ${platform}` };
  const binaryName = thunderBinaryName(THUNDER_DAEMON_BIN, platform);

  const explicit = env.AGENT_RESUME_THUNDER_BIN?.trim();
  if (explicit) {
    if (!exists(explicit)) {
      return { ok: false, reason: `AGENT_RESUME_THUNDER_BIN points at a missing file: ${explicit}` };
    }
    return { ok: true, binaryPath: explicit, source: "env-bin", target };
  }

  const artifactDir = env.AGENT_RESUME_THUNDER_DIR?.trim();
  if (artifactDir) {
    const candidates = [
      path.join(artifactDir, arch, binaryName),
      path.join(artifactDir, binaryName)
    ];
    for (const candidate of candidates) {
      if (exists(candidate)) return { ok: true, binaryPath: candidate, source: "artifact-dir", target };
    }
    // A per-arch artifact dir that exists but is empty must not silently fall through
    // to a host build: that would ship the wrong architecture.
    if (exists(path.join(artifactDir, arch))) {
      return { ok: false, reason: `no ${binaryName} in ${path.join(artifactDir, arch)}` };
    }
  }

  const checkout = findCheckout({ env, homedir, exists, log });
  if (!checkout) {
    return {
      ok: false,
      reason: "no thunder checkout found",
      hint: "Set THUNDER_PATH=/path/to/thunder, or AGENT_RESUME_THUNDER_BIN / AGENT_RESUME_THUNDER_DIR for prebuilt binaries."
    };
  }

  const crateDir = path.join(checkout, "thunder-agent-daemon");
  const host = thunderTargetFor(hostArch, platform) ?? hostTarget(platform);
  const crossCompile = target !== host;
  const args = ["build", "--release", "-p", "thunder-agent-daemon"];
  if (crossCompile) args.push("--target", target);

  const run = runCargo ?? defaultRunCargo;
  const built = run({ crateDir, args, log });
  if (!built?.ok) {
    return {
      ok: false,
      reason: `cargo build failed in ${crateDir}: ${built?.message ?? "unknown error"}`,
      hint: crossCompile ? `Cross builds need the target installed: rustup target add ${target}` : undefined
    };
  }

  // Unified workspace outputs to `<repo>/target`; legacy per-crate checkouts output
  // to `<crate>/target`. Probe the unified path first so both layouts work.
  const targetSeg = crossCompile ? [target] : [];
  const candidates = [
    path.join(checkout, "target", ...targetSeg, "release", binaryName),
    path.join(crateDir, "target", ...targetSeg, "release", binaryName)
  ];
  const binaryPath = candidates.find((candidate) => exists(candidate));
  if (!binaryPath) {
    return { ok: false, reason: `cargo reported success but none of these exist: ${candidates.join(", ")}` };
  }
  return { ok: true, binaryPath, source: "cargo-build", target, checkout };
}

/**
 * Find or build a `thunder-tui` for `arch`, mirroring the daemon rules. The TUI
 * builds from the workspace root (`cargo build -p thunder-tui`) into
 * `<checkout>/target/<target?>/release/thunder-tui`.
 */
export function resolveThunderTuiBinary({
  arch,
  platform = process.platform,
  env = process.env,
  hostArch = process.arch,
  homedir = os.homedir(),
  exists = fs.existsSync,
  runCargo,
  findCheckout = findThunderCheckout,
  log = console.log
}) {
  const target = thunderTargetFor(arch, platform);
  if (!target) return { ok: false, reason: `unsupported arch "${arch}" for ${platform}` };
  const binaryName = thunderBinaryName(THUNDER_TUI_BIN, platform);

  const explicit = env.AGENT_RESUME_THUNDER_TUI_BIN?.trim();
  if (explicit) {
    if (!exists(explicit)) {
      return { ok: false, reason: `AGENT_RESUME_THUNDER_TUI_BIN points at a missing file: ${explicit}` };
    }
    return { ok: true, binaryPath: explicit, source: "env-bin", target };
  }

  const artifactDir = env.AGENT_RESUME_THUNDER_TUI_DIR?.trim() || env.AGENT_RESUME_THUNDER_DIR?.trim();
  if (artifactDir) {
    const candidates = [
      path.join(artifactDir, arch, binaryName),
      path.join(artifactDir, binaryName)
    ];
    for (const candidate of candidates) {
      if (exists(candidate)) return { ok: true, binaryPath: candidate, source: "artifact-dir", target };
    }
  }

  const checkout = findCheckout({ env, homedir, exists, log });
  if (!checkout) {
    return {
      ok: false,
      reason: "no thunder checkout found",
      hint: "Set THUNDER_PATH=/path/to/thunder, or AGENT_RESUME_THUNDER_TUI_BIN / AGENT_RESUME_THUNDER_TUI_DIR for prebuilt binaries."
    };
  }

  const host = thunderTargetFor(hostArch, platform) ?? hostTarget(platform);
  const crossCompile = target !== host;
  const args = ["build", "--release", "-p", "thunder-tui"];
  if (crossCompile) args.push("--target", target);

  const run = runCargo ?? defaultRunCargo;
  const built = run({ crateDir: checkout, args, log });
  if (!built?.ok) {
    return {
      ok: false,
      reason: `cargo build failed in ${checkout}: ${built?.message ?? "unknown error"}`,
      hint: crossCompile ? `Cross builds need the target installed: rustup target add ${target}` : undefined
    };
  }

  const targetSeg = crossCompile ? [target] : [];
  const candidates = [
    path.join(checkout, "target", ...targetSeg, "release", binaryName),
    path.join(checkout, "thunder-agent-core", "tui", "target", ...targetSeg, "release", binaryName)
  ];
  const binaryPath = candidates.find((candidate) => exists(candidate));
  if (!binaryPath) {
    return { ok: false, reason: `cargo reported success but none of these exist: ${candidates.join(", ")}` };
  }
  return { ok: true, binaryPath, source: "cargo-build", target, checkout };
}

function defaultRunCargo({ crateDir, args, log }) {
  const home = os.homedir();
  const candidates = [process.env.CARGO, "cargo", path.join(home, ".cargo", "bin", "cargo")].filter(Boolean);
  let lastError = null;
  for (const cargo of candidates) {
    if (cargo.includes(path.sep) && !fs.existsSync(cargo)) continue;
    const result = spawnSync(cargo, args, { cwd: crateDir, stdio: "inherit" });
    if (result.error) {
      // Rust installed but not on PATH is the common case when packing from a GUI shell.
      lastError = result.error.message;
      continue;
    }
    if (result.status !== 0) {
      return { ok: false, message: `exit ${result.status}` };
    }
    log?.(`[thunder-sidecar] built ${THUNDER_DAEMON_BIN} via cargo (${args.join(" ")})`);
    return { ok: true };
  }
  return { ok: false, message: lastError ? `${lastError} (cargo not found)` : "cargo not found" };
}

/**
 * Resolve + copy the daemon into the staging dir for one arch.
 * `require: true` (release builds) turns a missing binary into an error.
 */
export function stageThunderSidecar(arch, {
  platform = process.platform,
  require: required = false,
  log = console.log,
  resolve: resolveBinary = resolveThunderBinary,
  ...resolveOptions
} = {}) {
  const resolved = resolveBinary({ arch, platform, log, ...resolveOptions });
  if (!resolved.ok) {
    const message = `[thunder-sidecar] ${arch}: ${resolved.reason}${resolved.hint ? ` — ${resolved.hint}` : ""}`;
    if (required) throw new Error(message);
    log(`${message} → packaging without a bundled daemon (Chat falls back to THUNDER_PATH / settings).`);
    return { ok: false, arch, reason: resolved.reason, hint: resolved.hint };
  }

  const stagedBinary = stagedBinaryPath(arch, platform);
  fs.mkdirSync(path.dirname(stagedBinary), { recursive: true });
  fs.rmSync(stagedBinary, { force: true });
  fs.copyFileSync(resolved.binaryPath, stagedBinary);
  if (platform !== "win32") fs.chmodSync(stagedBinary, 0o755);

  const metadata = {
    arch,
    target: resolved.target,
    source: resolved.source,
    checkout: resolved.checkout ?? null,
    // Hash of the file *as staged*: code signing rewrites the embedded signature, so
    // the copy inside the bundle will not hash the same. Useful as a "which build is
    // in here" fingerprint, not as a verification checksum.
    sha256Staged: sha256(stagedBinary),
    bytes: fs.statSync(stagedBinary).size,
    stagedAt: new Date().toISOString()
  };
  writeVersionMetadata(arch, metadata, undefined, platform);
  log(
    `[thunder-sidecar] ${arch}: staged ${THUNDER_DAEMON_BIN} (${metadata.source}, ${(metadata.bytes / 1e6).toFixed(1)} MB, staged sha256 ${metadata.sha256Staged.slice(0, 12)}…)`
  );
  return { ok: true, arch, platform, resourceDir: sidecarResourceDir(arch, platform), stagedBinary, source: metadata.source, metadata };
}

/** Merge one arch's metadata into `VERSION.json` without dropping the sibling binary's entry. */
function writeVersionMetadata(arch, metadata, binKey, platform = process.platform) {
  const versionFile = path.join(sidecarResourceDir(arch, platform), "VERSION.json");
  let existing = {};
  try {
    existing = JSON.parse(fs.readFileSync(versionFile, "utf8"));
  } catch {
    existing = {};
  }
  const next = binKey ? { ...existing, [binKey]: metadata } : { ...existing, ...metadata };
  fs.writeFileSync(versionFile, `${JSON.stringify(next, null, 2)}\n`);
}

/**
 * Resolve + copy `thunder-tui` beside the daemon for one arch. Same staging dir,
 * so the runtime resolver finds it at `Contents/Resources/thunder/bin/thunder-tui`.
 */
export function stageThunderTui(arch, {
  platform = process.platform,
  require: required = false,
  log = console.log,
  resolve: resolveBinary = resolveThunderTuiBinary,
  ...resolveOptions
} = {}) {
  const resolved = resolveBinary({ arch, platform, log, ...resolveOptions });
  if (!resolved.ok) {
    const message = `[thunder-sidecar] ${arch}: ${resolved.reason}${resolved.hint ? ` — ${resolved.hint}` : ""}`;
    if (required) throw new Error(message);
    log(`${message} → packaging without a bundled TUI (cli:thunder falls back to THUNDER_PATH / settings).`);
    return { ok: false, arch, reason: resolved.reason, hint: resolved.hint };
  }

  const stagedBinary = stagedTuiBinaryPath(arch, platform);
  fs.mkdirSync(path.dirname(stagedBinary), { recursive: true });
  fs.rmSync(stagedBinary, { force: true });
  fs.copyFileSync(resolved.binaryPath, stagedBinary);
  if (platform !== "win32") fs.chmodSync(stagedBinary, 0o755);

  const metadata = {
    arch,
    target: resolved.target,
    source: resolved.source,
    checkout: resolved.checkout ?? null,
    sha256Staged: sha256(stagedBinary),
    bytes: fs.statSync(stagedBinary).size,
    stagedAt: new Date().toISOString()
  };
  writeVersionMetadata(arch, metadata, "tui", platform);
  log(
    `[thunder-sidecar] ${arch}: staged ${THUNDER_TUI_BIN} (${metadata.source}, ${(metadata.bytes / 1e6).toFixed(1)} MB, staged sha256 ${metadata.sha256Staged.slice(0, 12)}…)`
  );
  return { ok: true, arch, platform, resourceDir: sidecarResourceDir(arch, platform), stagedBinary, source: metadata.source, metadata };
}

/**
 * electron-packager's `extraResource` drops the given directory's basename into
 * `Contents/Resources`, so we hand it `<staging>/<arch>/thunder`.
 */
export function thunderResourcePaths(staged) {
  return staged?.ok ? [staged.resourceDir] : [];
}

/** Fail loudly instead of shipping an app whose Chat cannot start. */
export function assertBundledDaemon(appRoot, { exists = fs.existsSync, platform = process.platform } = {}) {
  const expected = bundledDaemonPath(appRoot, platform);
  if (!exists(expected)) {
    throw new Error(
      `Packaged app is missing the bundled Thunder daemon at ${expected}. ` +
        "extraResource layout changed or staging was skipped — fix before releasing."
    );
  }
  return expected;
}
