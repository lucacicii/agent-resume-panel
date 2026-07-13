import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = path.join(root, "release");
const stampFile = path.join(root, ".dev-app-stamp");
const iconPath = path.join(root, "dist", "resources", "icon.icns");
const targetArch = "universal";
const appBundlePath = path.join(
  releaseRoot,
  `Agent Resume-darwin-${targetArch}`,
  "Agent Resume.app"
);

export const desktopRoot = root;
export const macTargetArch = targetArch;

export function runDesktopBuild() {
  execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
}

export function findAppBundle() {
  return fs.existsSync(appBundlePath) ? appBundlePath : null;
}

function walkLatestMtime(target, latest = { value: 0 }) {
  if (!fs.existsSync(target)) return latest.value;
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(target)) {
      walkLatestMtime(path.join(target, name), latest);
    }
    return latest.value;
  }
  latest.value = Math.max(latest.value, stat.mtimeMs);
  return latest.value;
}

function repackInputs() {
  return [
    path.join(root, "src"),
    path.join(root, "package.json"),
    path.join(root, "scripts"),
    path.join(root, "..", "..", "resources", "app-icon.png"),
    path.join(root, "..", "..", "packages", "core", "src"),
    path.join(root, "..", "..", "packages", "core", "package.json")
  ];
}

function latestRepackMtime() {
  return Math.max(...repackInputs().map((input) => walkLatestMtime(input)));
}

export function isBuildStampCurrent(rawStamp, sourceMtime, arch = targetArch) {
  try {
    const stamp = JSON.parse(rawStamp);
    return stamp?.version === 1 && stamp.arch === arch && stamp.sourceMtime >= sourceMtime;
  } catch {
    return false;
  }
}

export function needsRepack() {
  if (!findAppBundle()) return true;
  if (!fs.existsSync(stampFile)) return true;
  return !isBuildStampCurrent(fs.readFileSync(stampFile, "utf8"), latestRepackMtime());
}

function materializeNodeModules() {
  const repoNm = path.join(root, "..", "..", "node_modules");
  const desktopNm = path.join(root, "node_modules");
  fs.mkdirSync(desktopNm, { recursive: true });
  for (const name of fs.readdirSync(desktopNm)) {
    if (name === "electron") continue;
    fs.rmSync(path.join(desktopNm, name), { recursive: true, force: true });
  }
  for (const name of fs.readdirSync(repoNm)) {
    if (name === ".bin") continue;
    fs.symlinkSync(path.join(repoNm, name), path.join(desktopNm, name), "dir");
  }
}

export function packMacApp() {
  if (process.platform !== "darwin") {
    throw new Error("pack:mac is only supported on macOS.");
  }
  if (!fs.existsSync(iconPath)) {
    throw new Error(`Missing app icon: ${iconPath}. Run npm run build first.`);
  }
  materializeNodeModules();
  console.log("Packaging macOS .app...");
  fs.rmSync(releaseRoot, { recursive: true, force: true });
  execFileSync(
    "npx",
    [
      "@electron/packager",
      ".",
      "Agent Resume",
      `--platform=darwin`,
      `--arch=${targetArch}`,
      `--icon=${iconPath}`,
      `--out=${releaseRoot}`,
      "--overwrite",
      "--asar.unpackDir=node_modules/node-pty",
      "--osx-universal.x64ArchFiles=**/node-pty/prebuilds/**",
      "--prune=true"
    ],
    { cwd: root, stdio: "inherit", env: { ...process.env, ELECTRON_RUN_AS_NODE: "" } }
  );
  const appBundle = findAppBundle();
  if (!appBundle) {
    throw new Error("Packaging finished but Agent Resume.app was not found under release/");
  }
  fs.writeFileSync(
    stampFile,
    JSON.stringify({ version: 1, arch: targetArch, sourceMtime: latestRepackMtime() })
  );
  return appBundle;
}

export function createMacDmg(appBundle) {
  if (process.platform !== "darwin") {
    throw new Error("DMG packaging is only supported on macOS.");
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const dmgName = `Agent Resume-${pkg.version}.dmg`;
  const dmgPath = path.join(releaseRoot, dmgName);
  fs.rmSync(dmgPath, { force: true });
  console.log("Creating DMG...");
  execFileSync(
    "hdiutil",
    ["create", "-volname", "Agent Resume", "-srcfolder", appBundle, "-ov", "-format", "UDZO", dmgPath],
    { stdio: "inherit" }
  );
  return dmgPath;
}
