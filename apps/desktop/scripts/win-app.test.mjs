/**
 * Platform-neutral assertions for the Windows packer.
 *
 * A full `pack-win.mjs` run needs Windows (Authenticode, PowerShell's
 * `Compress-Archive`, the win32 Electron zip). These tests cover the pure
 * pieces that decide *where* artifacts land and *which* native binary must be
 * present, so a mistake in path derivation fails on any host.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  nodePtyBinaryPath,
  packagedAppPath,
  packagedDirName
} from "./pack-common.mjs";
import { winAppPathFor, winTargetArches, winZipPathFor } from "./pack-win.mjs";

assert.deepEqual(winTargetArches, ["x64", "arm64"]);

assert.equal(packagedDirName("Agent Resume", "win32", "x64"), "Agent Resume-win32-x64");
assert.equal(
  packagedAppPath("Agent Resume", "win32", "arm64"),
  path.join(
    path.resolve(path.dirname(new URL(import.meta.url).pathname), ".."),
    "release",
    "Agent Resume-win32-arm64",
    "Agent Resume.exe"
  )
);
assert.equal(
  packagedAppPath("Agent Resume", "darwin", "arm64"),
  path.join(
    path.resolve(path.dirname(new URL(import.meta.url).pathname), ".."),
    "release",
    "Agent Resume-darwin-arm64",
    "Agent Resume.app"
  )
);

// Windows artifacts are platform-tagged: a mac build must never satisfy a
// Windows stamp check (and vice versa).
assert.ok(winAppPathFor("x64").includes("win32-x64"));
assert.ok(winAppPathFor("arm64").includes("win32-arm64"));
assert.ok(winZipPathFor("x64", "0.2.36").endsWith("Agent Resume-0.2.36-win32-x64.zip"));
assert.ok(winZipPathFor("arm64", "0.2.36").endsWith("Agent Resume-0.2.36-win32-arm64.zip"));

const root = fs.mkdtempSync(path.join(os.tmpdir(), "pack-win-"));
try {
  const nodePty = path.join(root, "node-pty");
  fs.mkdirSync(path.join(nodePty, "prebuilds", "win32-x64"), { recursive: true });
  fs.writeFileSync(path.join(nodePty, "prebuilds", "win32-x64", "pty.node"), "");
  assert.equal(
    nodePtyBinaryPath(nodePty, "win32", "x64"),
    path.join(nodePty, "prebuilds", "win32-x64", "pty.node")
  );
  // POSIX still needs the spawn-helper; the two must not be confused.
  assert.equal(
    nodePtyBinaryPath(nodePty, "darwin", "arm64"),
    path.join(nodePty, "prebuilds", "darwin-arm64", "spawn-helper")
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("win-app.test.mjs: all assertions passed");
