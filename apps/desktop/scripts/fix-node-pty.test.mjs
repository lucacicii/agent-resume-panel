import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureSpawnHelpersExecutable } from "./fix-node-pty.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "fix-node-pty-"));

try {
  const arm64 = path.join(root, "prebuilds", "darwin-arm64", "spawn-helper");
  const x64 = path.join(root, "prebuilds", "darwin-x64", "spawn-helper");
  const linux = path.join(root, "prebuilds", "linux-x64", "spawn-helper");

  for (const helper of [arm64, x64, linux]) {
    fs.mkdirSync(path.dirname(helper), { recursive: true });
    fs.writeFileSync(helper, "helper");
    fs.chmodSync(helper, 0o644);
  }

  const found = ensureSpawnHelpersExecutable(root, "darwin");
  assert.deepEqual(new Set(found), new Set([arm64, x64]));
  assert.notEqual(fs.statSync(arm64).mode & 0o111, 0);
  assert.notEqual(fs.statSync(x64).mode & 0o111, 0);
  assert.equal(fs.statSync(linux).mode & 0o111, 0);
  console.log("fix-node-pty.test.mjs: all assertions passed");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
