import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.join(desktopRoot, "..", "..");

function electronPackageDir(nodeModulesRoot) {
  return path.join(nodeModulesRoot, "electron");
}

function hasElectronBinary(pkgDir) {
  return fs.existsSync(path.join(pkgDir, "path.txt"));
}

function readElectronPath(pkgDir) {
  const pathFile = path.join(pkgDir, "path.txt");
  if (!fs.existsSync(pathFile)) {
    return null;
  }
  const relative = fs.readFileSync(pathFile, "utf8").trim();
  if (!relative) {
    return null;
  }
  if (process.env.ELECTRON_OVERRIDE_DIST_PATH) {
    return path.join(process.env.ELECTRON_OVERRIDE_DIST_PATH, relative);
  }
  return path.join(pkgDir, "dist", relative);
}

function removeBrokenNestedElectron() {
  const nested = electronPackageDir(path.join(desktopRoot, "node_modules"));
  if (!fs.existsSync(nested)) {
    return;
  }
  if (fs.lstatSync(nested).isSymbolicLink()) {
    return;
  }
  if (hasElectronBinary(nested)) {
    return;
  }
  fs.rmSync(nested, { recursive: true, force: true });
}

function runElectronInstall(pkgDir) {
  const installScript = path.join(pkgDir, "install.js");
  if (!fs.existsSync(installScript)) {
    throw new Error(`Missing electron install script: ${installScript}`);
  }
  execFileSync(process.execPath, [installScript], {
    cwd: pkgDir,
    stdio: "inherit",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "" }
  });
}

function reinstallElectronAtRoot() {
  execFileSync("npm", ["install", "electron", "-w", "@agent-resume/desktop", "--no-audit", "--no-fund"], {
    cwd: repoRoot,
    stdio: "inherit"
  });
}

/**
 * Ensures a hoisted root electron install with a downloaded binary.
 * Removes broken nested copies that win Node's module resolution.
 */
export function ensureElectron() {
  removeBrokenNestedElectron();

  const rootPkgDir = electronPackageDir(path.join(repoRoot, "node_modules"));
  if (!fs.existsSync(rootPkgDir)) {
    reinstallElectronAtRoot();
  }

  if (!hasElectronBinary(rootPkgDir)) {
    try {
      runElectronInstall(rootPkgDir);
    } catch {
      fs.rmSync(rootPkgDir, { recursive: true, force: true });
      reinstallElectronAtRoot();
    }
  }

  if (!hasElectronBinary(rootPkgDir)) {
    throw new Error(
      "Electron failed to install correctly. Run from repo root: rm -rf node_modules/electron apps/desktop/node_modules/electron && npm install"
    );
  }

  return readElectronPath(rootPkgDir);
}

export function resolveElectronPath() {
  const rootPkgDir = electronPackageDir(path.join(repoRoot, "node_modules"));
  const executablePath = readElectronPath(rootPkgDir);
  if (executablePath && fs.existsSync(executablePath)) {
    return executablePath;
  }
  return ensureElectron();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const electronPath = ensureElectron();
  console.log(`[ensure-electron] ${electronPath}`);
}