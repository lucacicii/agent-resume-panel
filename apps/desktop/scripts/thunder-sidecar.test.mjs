import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  THUNDER_TARGETS,
  assertBundledDaemon,
  bundledDaemonPath,
  findThunderCheckout,
  resolveThunderBinary,
  sidecarResourceDir,
  stagedBinaryPath,
  stageThunderSidecar,
  thunderResourcePaths
} from "./thunder-sidecar.mjs";

/** Virtual filesystem probe. */
const probe = (paths) => {
  const set = new Set(paths);
  return (candidate) => set.has(candidate);
};
const noCargo = () => {
  throw new Error("cargo must not run in this case");
};
const silent = () => undefined;

// ── resolution priority ─────────────────────────────────────────────────────
{
  const explicit = "/artifacts/thunder-daemon-arm64";
  const resolved = resolveThunderBinary({
    arch: "arm64",
    env: { AGENT_RESUME_THUNDER_BIN: explicit },
    exists: probe([explicit]),
    runCargo: noCargo,
    log: silent
  });
  assert.deepEqual(resolved, { ok: true, binaryPath: explicit, source: "env-bin", target: THUNDER_TARGETS.arm64 });
}

{
  // Per-arch artifact dir (CI): <dir>/<arch>/thunder-daemon.
  const artifactDir = "/ci-artifacts";
  const perArch = path.join(artifactDir, "x64", "thunder-daemon");
  const resolved = resolveThunderBinary({
    arch: "x64",
    env: { AGENT_RESUME_THUNDER_DIR: artifactDir },
    exists: probe([perArch, path.join(artifactDir, "x64")]),
    runCargo: noCargo,
    log: silent
  });
  assert.equal(resolved.source, "artifact-dir");
  assert.equal(resolved.binaryPath, perArch);
}

{
  // An empty per-arch artifact dir must fail rather than silently build the host arch.
  const artifactDir = "/ci-artifacts";
  const resolved = resolveThunderBinary({
    arch: "arm64",
    env: { AGENT_RESUME_THUNDER_DIR: artifactDir },
    exists: probe([path.join(artifactDir, "arm64")]),
    runCargo: noCargo,
    log: silent
  });
  assert.equal(resolved.ok, false);
  assert.match(resolved.reason, /no thunder-daemon in/);
}

{
  // Host-arch build: plain `cargo build --release -p thunder-agent-daemon`.
  const checkout = "/checkouts/thunder";
  const built = path.join(checkout, "thunder-agent-daemon/target/release/thunder-daemon");
  const calls = [];
  const resolved = resolveThunderBinary({
    arch: "x64",
    hostArch: "x64",
    env: { THUNDER_PATH: checkout },
    exists: probe([checkout, built]),
    runCargo: (call) => {
      calls.push(call);
      return { ok: true };
    },
    log: silent
  });
  assert.equal(resolved.source, "cargo-build");
  assert.equal(resolved.binaryPath, built);
  assert.deepEqual(calls[0].args, ["build", "--release", "-p", "thunder-agent-daemon"]);
  assert.equal(calls[0].crateDir, path.join(checkout, "thunder-agent-daemon"));
}

{
  // Cross build: --target <triple> and the target-scoped binary path.
  const checkout = "/checkouts/thunder";
  const built = path.join(checkout, "thunder-agent-daemon/target/aarch64-apple-darwin/release/thunder-daemon");
  const calls = [];
  const resolved = resolveThunderBinary({
    arch: "arm64",
    hostArch: "x64",
    env: { THUNDER_PATH: checkout },
    exists: probe([checkout, built]),
    runCargo: (call) => {
      calls.push(call);
      return { ok: true };
    },
    log: silent
  });
  assert.equal(resolved.binaryPath, built);
  assert.deepEqual(calls[0].args, ["build", "--release", "-p", "thunder-agent-daemon", "--target", "aarch64-apple-darwin"]);
}

{
  // Missing rust target → actionable hint.
  const checkout = "/checkouts/thunder";
  const resolved = resolveThunderBinary({
    arch: "arm64",
    hostArch: "x64",
    env: { THUNDER_PATH: checkout },
    exists: probe([checkout]),
    runCargo: () => ({ ok: false, message: "exit 101" }),
    log: silent
  });
  assert.equal(resolved.ok, false);
  assert.match(resolved.reason, /cargo build failed/);
  assert.match(resolved.hint, /rustup target add aarch64-apple-darwin/);
}

{
  // No checkout at all → warn, with a hint about the env overrides.
  const resolved = resolveThunderBinary({
    arch: "x64",
    env: {},
    homedir: "/Users/nobody",
    exists: probe([]),
    findCheckout: () => null,
    runCargo: noCargo,
    log: silent
  });
  assert.equal(resolved.ok, false);
  assert.match(resolved.reason, /no thunder checkout/);
  assert.match(resolved.hint, /THUNDER_PATH/);
}

// ── checkout discovery ──────────────────────────────────────────────────────
{
  assert.equal(findThunderCheckout({ env: { THUNDER_PATH: "/pinned/thunder" }, exists: probe(["/pinned/thunder"]), log: silent }), "/pinned/thunder");
  assert.equal(findThunderCheckout({ env: { THUNDER_PATH: "/gone" }, homedir: "/Users/nobody", exists: probe([]), log: silent }), null);
  // Falls back to $HOME probes when the compiled resolver finds nothing.
  assert.equal(
    findThunderCheckout({ env: {}, homedir: "/Users/nobody", exists: probe(["/Users/nobody/GitHub/thunder"]), log: silent }),
    "/Users/nobody/GitHub/thunder"
  );
}

// ── staging layout: must match what the runtime resolver probes ─────────────
{
  // The runtime (daemonResolver.ts, source "bundled") probes
  // `<app>/Contents/Resources/thunder/bin/thunder-daemon`, and electron-packager maps
  // `extraResource: [<staging>/<arch>/thunder]` → `<app>/Contents/Resources/thunder`.
  const resourcesRoot = "/Applications/Agent Resume.app/Contents/Resources";
  assert.equal(
    bundledDaemonPath("/Applications/Agent Resume.app"),
    path.join(resourcesRoot, path.basename(sidecarResourceDir("x64")), path.relative(sidecarResourceDir("x64"), stagedBinaryPath("x64")))
  );

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "thunder-sidecar-"));
  const fakeBinary = path.join(tempRoot, "thunder-daemon");
  fs.writeFileSync(fakeBinary, "#!/bin/sh\necho stub\n");
  fs.chmodSync(fakeBinary, 0o644);

  const staged = stageThunderSidecar("x64", {
    resolve: () => ({ ok: true, binaryPath: fakeBinary, source: "test", target: THUNDER_TARGETS.x64 }),
    log: silent
  });
  assert.equal(staged.ok, true);

  const stagedFile = stagedBinaryPath("x64");
  assert.equal(fs.existsSync(stagedFile), true, `expected ${stagedFile} to be staged`);
  assert.equal(fs.statSync(stagedFile).mode & 0o111, 0o111, "staged daemon must be executable");
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(staged.resourceDir, "VERSION.json"), "utf8")).source,
    "test"
  );
  assert.deepEqual(thunderResourcePaths(staged), [staged.resourceDir]);

  // `extraResource` keeps the basename, so the staged dir must be named `thunder`.
  assert.equal(path.basename(staged.resourceDir), "thunder");

  // Cleanup the arch staging dir this test wrote.
  fs.rmSync(path.dirname(staged.resourceDir), { recursive: true, force: true });
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

{
  // require: true must throw instead of shipping a silent fallback.
  assert.throws(
    () => stageThunderSidecar("arm64", { require: true, resolve: () => ({ ok: false, reason: "nope" }), log: silent }),
    /nope/
  );
  const skipped = stageThunderSidecar("arm64", { resolve: () => ({ ok: false, reason: "nope" }), log: silent });
  assert.equal(skipped.ok, false);
  assert.deepEqual(thunderResourcePaths(skipped), []);
}

{
  assert.throws(() => assertBundledDaemon("/Applications/Agent Resume.app", { exists: probe([]) }), /missing the bundled Thunder daemon/);
  assert.equal(
    assertBundledDaemon("/Applications/Agent Resume.app", { exists: probe([bundledDaemonPath("/Applications/Agent Resume.app")]) }),
    bundledDaemonPath("/Applications/Agent Resume.app")
  );
}

console.log("thunder-sidecar tests passed");
