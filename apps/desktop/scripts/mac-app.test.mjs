import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  flattenDeployedNodeModulesForAsar,
  isBuildStampCurrent,
  macTargetArch,
  packageNameFromMapKey,
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

  assert.equal(packageNameFromMapKey("@modelcontextprotocol/sdk@1.29.0(zod@4.4.3)"), "@modelcontextprotocol/sdk");
  assert.equal(packageNameFromMapKey("zod@4.4.3"), "zod");
  assert.equal(packageNameFromMapKey("@agent-resume/core@file:packages/core"), "@agent-resume/core");
  assert.equal(packageNameFromMapKey("."), null);
  assert.equal(packageNameFromMapKey("packages/core"), null);
  assert.equal(packageNameFromMapKey("apps/desktop"), null);
  assert.equal(packageNameFromMapKey("apps/extension"), null);

  const flattenRoot = path.join(testRoot, "flatten");
  const flattenNm = path.join(flattenRoot, "node_modules");
  const pnpmCore = path.join(
    flattenNm,
    ".pnpm",
    "@agent-resume+core@file+packages+core",
    "node_modules",
    "@agent-resume",
    "core"
  );
  const pnpmSdk = path.join(
    flattenNm,
    ".pnpm",
    "@modelcontextprotocol+sdk@1.29.0_zod@4.4.3",
    "node_modules",
    "@modelcontextprotocol",
    "sdk"
  );
  fs.mkdirSync(pnpmCore, { recursive: true });
  fs.mkdirSync(pnpmSdk, { recursive: true });
  fs.writeFileSync(path.join(pnpmCore, "package.json"), JSON.stringify({ name: "@agent-resume/core" }));
  fs.writeFileSync(path.join(pnpmSdk, "package.json"), JSON.stringify({ name: "@modelcontextprotocol/sdk" }));
  fs.mkdirSync(path.join(flattenNm, "@agent-resume"), { recursive: true });
  fs.symlinkSync(pnpmCore, path.join(flattenNm, "@agent-resume", "core"), "dir");
  fs.writeFileSync(
    path.join(flattenNm, ".package-map.json"),
    JSON.stringify({
      packages: {
        ".": { url: "../../.." },
        "@agent-resume/core@file:packages/core": {
          url: "./.pnpm/@agent-resume+core@file+packages+core/node_modules/@agent-resume/core"
        },
        "@modelcontextprotocol/sdk@1.29.0(zod@4.4.3)": {
          url: "./.pnpm/@modelcontextprotocol+sdk@1.29.0_zod@4.4.3/node_modules/@modelcontextprotocol/sdk"
        }
      }
    })
  );

  flattenDeployedNodeModulesForAsar(flattenRoot);

  const flatCore = path.join(flattenNm, "@agent-resume", "core");
  const flatSdk = path.join(flattenNm, "@modelcontextprotocol", "sdk");
  assert.equal(fs.lstatSync(flatCore).isSymbolicLink(), false);
  assert.equal(fs.lstatSync(flatSdk).isSymbolicLink(), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(flatSdk, "package.json"), "utf8")).name, "@modelcontextprotocol/sdk");
  assert.equal(fs.existsSync(path.join(flattenNm, ".pnpm")), false);
  assert.equal(fs.existsSync(path.join(flattenNm, ".package-map.json")), false);
} finally {
  fs.rmSync(testRoot, { recursive: true, force: true });
}

console.log("mac-app.test.mjs: all assertions passed");
