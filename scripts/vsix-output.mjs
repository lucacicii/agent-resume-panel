import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
export const distDir = join(root, "dist");

export function packageVsix(outName, cwd = root) {
  mkdirSync(distDir, { recursive: true });
  const outPath = join(distDir, outName);
  execFileSync("npx", ["vsce", "package", "--follow-symlinks", "-o", outPath], {
    cwd,
    stdio: "inherit",
  });
  return outPath;
}

export function distVsixPath(name, version) {
  return join(distDir, `${name}-${version}.vsix`);
}
