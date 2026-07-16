import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
export const distDir = join(root, "dist");

export function syncDependenciesForPackaging(cwd = root) {
  console.log("Syncing dependencies for VSIX packaging...");
  execFileSync("npm", ["install"], { cwd, stdio: "inherit" });
}

export function pruneProductionDependencies(cwd = root) {
  console.log("Pruning extraneous production dependencies...");
  execFileSync("npm", ["prune", "--omit=dev"], { cwd, stdio: "inherit" });
}

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
