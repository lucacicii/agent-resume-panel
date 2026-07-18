import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { stageVsix } from "./stage-vsix.mjs";

const extensionRoot = join(import.meta.dirname, "..");
export const distDir = join(extensionRoot, "dist");
const require = createRequire(import.meta.url);

function resolveVsceBin() {
  try {
    return require.resolve("@vscode/vsce/vsce", { paths: [extensionRoot] });
  } catch {
    throw new Error(
      "Missing @vscode/vsce. Run `pnpm install` from the repo root."
    );
  }
}

export function packageVsix(outName) {
  const stagingDir = stageVsix();
  mkdirSync(distDir, { recursive: true });
  const outPath = join(distDir, outName);
  const vsceBin = resolveVsceBin();
  execFileSync(process.execPath, [vsceBin, "package", "-o", outPath], {
    cwd: stagingDir,
    stdio: "inherit"
  });
  return outPath;
}

export function distVsixPath(name, version) {
  return join(distDir, `${name}-${version}.vsix`);
}
