#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { packageVsix } from "./vsix-output.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.join(scriptDir, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8"));

if (!fs.existsSync(path.join(extensionRoot, "out", "extension.js"))) {
  throw new Error("Missing out/extension.js — run pnpm run compile first.");
}

const vsixPath = packageVsix(`${pkg.name}-${pkg.version}.test.vsix`);
const tempRoot = await mkdtemp(path.join(tmpdir(), "agent-resume-vsix-test-"));

try {
  execFileSync("unzip", ["-q", vsixPath, "-d", tempRoot], { stdio: "pipe" });
  const extRoot = path.join(tempRoot, "extension");
  const coreEntry = path.join(extRoot, "node_modules", "@agent-resume", "core", "dist", "extension.js");
  assert.ok(fs.existsSync(coreEntry), `VSIX must contain ${coreEntry}`);

  const corePkgPath = path.join(extRoot, "node_modules", "@agent-resume", "core", "package.json");
  const corePkg = JSON.parse(fs.readFileSync(corePkgPath, "utf8"));
  assert.ok(corePkg.exports?.["./extension"], "vendored @agent-resume/core must expose ./extension in exports");

  for (const dependency of ["@agentclientprotocol/sdk", "dompurify", "marked", "zod"]) {
    const dependencyPath = path.join(extRoot, "node_modules", ...dependency.split("/"));
    assert.ok(fs.existsSync(dependencyPath), `VSIX must contain runtime dependency ${dependency}`);
  }

  for (const metadata of ["pnpm-lock.yaml", "pnpm-workspace.yaml", ".pnpm-workspace-state-v1.json", ".npmrc"]) {
    assert.equal(fs.existsSync(path.join(extRoot, metadata)), false, `VSIX must exclude ${metadata}`);
  }

  for (const file of ["README.md", "CHANGELOG.md", "LICENSE"]) {
    const filePath = path.join(extRoot, file);
    assert.ok(fs.existsSync(filePath), `VSIX must contain ${file} for extension details tabs`);
    assert.ok(fs.statSync(filePath).size > 0, `VSIX ${file} must not be empty`);
  }

  let nodeModulesCount = 0;
  const nmRoot = path.join(extRoot, "node_modules");
  assert.ok(fs.existsSync(nmRoot), "VSIX must contain node_modules/");

  function countFiles(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        countFiles(entryPath);
      } else {
        nodeModulesCount += 1;
      }
    }
  }
  countFiles(nmRoot);
  assert.ok(nodeModulesCount > 100, `expected >100 files in node_modules, got ${nodeModulesCount}`);

  const stat = fs.statSync(vsixPath);
  assert.ok(stat.size > 3_000_000, `expected VSIX >3MB, got ${stat.size}`);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
  fs.rmSync(vsixPath, { force: true });
}

console.log("pack-vsix.test.mjs: all assertions passed");
