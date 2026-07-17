import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isBuildStampCurrent,
  macTargetArch,
  removeDesktopSelfReferences,
  stageMacDmgContents
} from "./mac-app.mjs";

assert.equal(macTargetArch, "universal");
assert.equal(
  isBuildStampCurrent(
    JSON.stringify({
      version: 1,
      arch: "universal",
      bundleId: "com.thunder-luc.agent-resume",
      sourceMtime: 200
    }),
    200
  ),
  true
);
assert.equal(
  isBuildStampCurrent(
    JSON.stringify({
      version: 1,
      arch: "universal",
      bundleId: "com.thunder-luc.agent-resume",
      sourceMtime: 199
    }),
    200
  ),
  false
);
assert.equal(
  isBuildStampCurrent(
    JSON.stringify({
      version: 1,
      arch: "arm64",
      bundleId: "com.thunder-luc.agent-resume",
      sourceMtime: 200
    }),
    200
  ),
  false
);
assert.equal(
  isBuildStampCurrent(JSON.stringify({ version: 1, arch: "universal", sourceMtime: 200 }), 200),
  false
);
assert.equal(isBuildStampCurrent("200", 200), false);
assert.equal(isBuildStampCurrent("invalid", 200), false);

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-resume-mac-app-test-"));
try {
  const appBundle = path.join(testRoot, "Agent Resume.app");
  const contentsDir = path.join(appBundle, "Contents");
  const stagingDir = path.join(testRoot, "dmg-root");
  fs.mkdirSync(contentsDir, { recursive: true });
  fs.writeFileSync(path.join(contentsDir, "Info.plist"), "test");

  stageMacDmgContents(appBundle, stagingDir);

  assert.equal(fs.readFileSync(path.join(stagingDir, "Agent Resume.app", "Contents", "Info.plist"), "utf8"), "test");
  assert.equal(fs.lstatSync(path.join(stagingDir, "Applications")).isSymbolicLink(), true);
  assert.equal(fs.readlinkSync(path.join(stagingDir, "Applications")), "/Applications");

  const deployRoot = path.join(testRoot, "deploy");
  const selfReferences = [
    path.join(deployRoot, "node_modules", "@agent-resume", "desktop"),
    path.join(deployRoot, "node_modules", ".pnpm", "node_modules", "@agent-resume", "desktop")
  ];
  for (const selfReference of selfReferences) {
    fs.mkdirSync(path.dirname(selfReference), { recursive: true });
    fs.symlinkSync(deployRoot, selfReference, "dir");
  }
  const coreReference = path.join(deployRoot, "node_modules", "@agent-resume", "core");
  fs.mkdirSync(coreReference, { recursive: true });

  removeDesktopSelfReferences(deployRoot);

  assert.equal(selfReferences.some((selfReference) => fs.existsSync(selfReference)), false);
  assert.equal(fs.existsSync(coreReference), true);
} finally {
  fs.rmSync(testRoot, { recursive: true, force: true });
}

console.log("mac-app.test.mjs: all assertions passed");
