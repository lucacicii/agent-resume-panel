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

export const THUNDER_TARGETS = { x64: "x86_64-apple-darwin", arm64: "aarch64-apple-darwin" };
export const THUNDER_DAEMON_BIN = "thunder-daemon";

/** Relative layout inside the bundle: `Contents/Resources/thunder` + `bin/thunder-daemon`. */
const RESOURCE_DIR_NAME = "thunder";
const BUNDLE_SUBDIR = ["bin"];

export function hostTarget() {
  return THUNDER_TARGETS[process.arch] ?? null;
}

/** Staging root for one arch (`apps/desktop/.thunder-sidecar/<arch>`). */
export function sidecarDir(arch) {
  return path.join(sidecarRoot, arch);
}

/** Directory handed to electron-packager's `extraResource` (becomes `Resources/thunder`). */
export function sidecarResourceDir(arch) {
  return path.join(sidecarDir(arch), RESOURCE_DIR_NAME);
}

export function stagedBinaryPath(arch) {
  return path.join(sidecarResourceDir(arch), ...BUNDLE_SUBDIR, THUNDER_DAEMON_BIN);
}

/** Where the daemon must end up inside a packaged `.app`. */
export function bundledDaemonPath(appBundle) {
  return path.join(appBundle, "Contents", "Resources", RESOURCE_DIR_NAME, ...BUNDLE_SUBDIR, THUNDER_DAEMON_BIN);
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
  env = process.env,
  hostArch = process.arch,
  homedir = os.homedir(),
  exists = fs.existsSync,
  runCargo,
  findCheckout = findThunderCheckout,
  log = console.log
}) {
  const target = THUNDER_TARGETS[arch];
  if (!target) return { ok: false, reason: `unsupported arch "${arch}"` };

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
      path.join(artifactDir, arch, THUNDER_DAEMON_BIN),
      path.join(artifactDir, THUNDER_DAEMON_BIN)
    ];
    for (const candidate of candidates) {
      if (exists(candidate)) return { ok: true, binaryPath: candidate, source: "artifact-dir", target };
    }
    // A per-arch artifact dir that exists but is empty must not silently fall through
    // to a host build: that would ship the wrong architecture.
    if (exists(path.join(artifactDir, arch))) {
      return { ok: false, reason: `no ${THUNDER_DAEMON_BIN} in ${path.join(artifactDir, arch)}` };
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
  const host = THUNDER_TARGETS[hostArch] ?? hostTarget();
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

  const binaryPath = path.join(crateDir, "target", ...(crossCompile ? [target] : []), "release", THUNDER_DAEMON_BIN);
  if (!exists(binaryPath)) {
    return { ok: false, reason: `cargo reported success but ${binaryPath} is missing` };
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
  require: required = false,
  log = console.log,
  resolve: resolveBinary = resolveThunderBinary,
  ...resolveOptions
} = {}) {
  const resolved = resolveBinary({ arch, log, ...resolveOptions });
  if (!resolved.ok) {
    const message = `[thunder-sidecar] ${arch}: ${resolved.reason}${resolved.hint ? ` — ${resolved.hint}` : ""}`;
    if (required) throw new Error(message);
    log(`${message} → packaging without a bundled daemon (Chat falls back to THUNDER_PATH / settings).`);
    return { ok: false, arch, reason: resolved.reason, hint: resolved.hint };
  }

  const stagedBinary = stagedBinaryPath(arch);
  fs.rmSync(sidecarResourceDir(arch), { recursive: true, force: true });
  fs.mkdirSync(path.dirname(stagedBinary), { recursive: true });
  fs.copyFileSync(resolved.binaryPath, stagedBinary);
  fs.chmodSync(stagedBinary, 0o755);

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
  fs.writeFileSync(
    path.join(sidecarResourceDir(arch), "VERSION.json"),
    `${JSON.stringify(metadata, null, 2)}\n`
  );
  log(
    `[thunder-sidecar] ${arch}: staged ${THUNDER_DAEMON_BIN} (${metadata.source}, ${(metadata.bytes / 1e6).toFixed(1)} MB, staged sha256 ${metadata.sha256Staged.slice(0, 12)}…)`
  );
  return { ok: true, arch, resourceDir: sidecarResourceDir(arch), stagedBinary, source: metadata.source, metadata };
}

/**
 * electron-packager's `extraResource` drops the given directory's basename into
 * `Contents/Resources`, so we hand it `<staging>/<arch>/thunder`.
 */
export function thunderResourcePaths(staged) {
  return staged?.ok ? [staged.resourceDir] : [];
}

/** Fail loudly instead of shipping an app whose Chat cannot start. */
export function assertBundledDaemon(appBundle, { exists = fs.existsSync } = {}) {
  const expected = bundledDaemonPath(appBundle);
  if (!exists(expected)) {
    throw new Error(
      `Packaged app is missing the bundled Thunder daemon at ${expected}. ` +
        "extraResource layout changed or staging was skipped — fix before releasing."
    );
  }
  return expected;
}
