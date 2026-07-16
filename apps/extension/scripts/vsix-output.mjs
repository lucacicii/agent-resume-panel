import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { delimiter, join } from "node:path";

import { stageVsix } from "./stage-vsix.mjs";

const extensionRoot = join(import.meta.dirname, "..");
const repoRoot = join(extensionRoot, "..", "..");
export const distDir = join(extensionRoot, "dist");
const require = createRequire(import.meta.url);

function resolveVsceBin() {
  try {
    return require.resolve("@vscode/vsce/vsce", { paths: [extensionRoot, repoRoot] });
  } catch {
    throw new Error(
      "Missing @vscode/vsce. Run `npm install` from the repo root (or `npm install -w agent-resume-panel`)."
    );
  }
}

export function packageVsix(outName) {
  const stagingDir = stageVsix();
  mkdirSync(distDir, { recursive: true });
  const outPath = join(distDir, outName);
  const vsceBin = resolveVsceBin();
  const nodeModulesPath = join(repoRoot, "node_modules");
  const nodePath = [nodeModulesPath, process.env.NODE_PATH].filter(Boolean).join(delimiter);
  execFileSync(process.execPath, [vsceBin, "package", "-o", outPath], {
    cwd: stagingDir,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_PATH: nodePath
    }
  });
  return outPath;
}

export function distVsixPath(name, version) {
  return join(distDir, `${name}-${version}.vsix`);
}