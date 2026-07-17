import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

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

function resolveElectronPackageDir() {
  try {
    return path.dirname(require.resolve("electron/package.json"));
  } catch {
    throw new Error("Missing Electron for @agent-resume/desktop. Run `pnpm install` from the repo root.");
  }
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

export function ensureElectron() {
  const pkgDir = resolveElectronPackageDir();
  if (!hasElectronBinary(pkgDir)) {
    runElectronInstall(pkgDir);
  }

  if (!hasElectronBinary(pkgDir)) {
    throw new Error(
      "Electron failed to install correctly. Run `pnpm install --force` from the repo root."
    );
  }

  return readElectronPath(pkgDir);
}

export function resolveElectronPath() {
  const pkgDir = resolveElectronPackageDir();
  const executablePath = readElectronPath(pkgDir);
  if (executablePath && fs.existsSync(executablePath)) {
    return executablePath;
  }
  return ensureElectron();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const electronPath = ensureElectron();
  console.log(`[ensure-electron] ${electronPath}`);
}
