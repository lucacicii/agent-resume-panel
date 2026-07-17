import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { downloadArtifact } from "@electron/get";
import { ensureSpawnHelpersExecutable } from "./fix-node-pty.mjs";

const require = createRequire(import.meta.url);
const PACKAGER_ATTEMPTS = 3;
const DOWNLOAD_ATTEMPTS = 4;
const RETRY_DELAY_MS = 2000;

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = path.join(root, "release");
const packagingRoot = path.join(root, ".pack-staging");
const repoRoot = path.join(root, "..", "..");
const stampFile = path.join(root, ".dev-app-stamp");
const iconPath = path.join(root, "dist", "resources", "icon.icns");
const targetArch = "universal";
const bundleId = "com.thunder-luc.agent-resume";
const appBundlePath = path.join(
  releaseRoot,
  `Agent Resume-darwin-${targetArch}`,
  "Agent Resume.app"
);

export const desktopRoot = root;
export const macTargetArch = targetArch;

export function runDesktopBuild() {
  execFileSync("pnpm", ["run", "build"], { cwd: root, stdio: "inherit" });
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
    path.join(root, "dist", "renderer"),
    path.join(root, "..", "extension", "package.json"),
    path.join(root, "scripts"),
    path.join(root, "..", "extension", "resources", "app-icon.png"),
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
    return (
      stamp?.version === 1 &&
      stamp.arch === arch &&
      stamp.bundleId === bundleId &&
      stamp.sourceMtime >= sourceMtime
    );
  } catch {
    return false;
  }
}

export function needsRepack() {
  if (!findAppBundle()) return true;
  if (!fs.existsSync(stampFile)) return true;
  return !isBuildStampCurrent(fs.readFileSync(stampFile, "utf8"), latestRepackMtime());
}

function signMacApp(appBundle) {
  const identity = process.env.AGENT_RESUME_CODESIGN_IDENTITY || "-";
  console.log(`Signing macOS app with identity: ${identity}`);
  execFileSync("codesign", ["--force", "--deep", "--sign", identity, appBundle], {
    cwd: root,
    stdio: "inherit"
  });
}

function installedElectronVersion() {
  return require("electron/package.json").version;
}

function electronZipDirForVersion(version = installedElectronVersion()) {
  return path.join(root, ".electron-zips", `v${version}`);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(label, attempts, fn) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      const delay = RETRY_DELAY_MS * attempt;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`${label} failed (attempt ${attempt}/${attempts}): ${message}. Retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }
  throw lastError;
}

async function ensureElectronZipDir() {
  const version = installedElectronVersion();
  const zipDir = electronZipDirForVersion(version);
  fs.mkdirSync(zipDir, { recursive: true });

  for (const arch of ["x64", "arm64"]) {
    const fileName = `electron-v${version}-darwin-${arch}.zip`;
    const dest = path.join(zipDir, fileName);
    if (fs.existsSync(dest)) continue;

    console.log(`Fetching Electron ${version} darwin-${arch}...`);
    const cached = await withRetry(`Electron ${arch} download`, DOWNLOAD_ATTEMPTS, () =>
      downloadArtifact({
        version,
        platform: "darwin",
        arch,
        artifactName: "electron"
      })
    );
    fs.copyFileSync(cached, dest);
  }

  return zipDir;
}

function deployDesktop() {
  fs.rmSync(packagingRoot, { recursive: true, force: true });
  execFileSync(
    "pnpm",
    ["--filter", "@agent-resume/desktop", "--prod", "deploy", "--legacy", packagingRoot],
    { cwd: repoRoot, stdio: "inherit" }
  );

  removeDesktopSelfReferences(packagingRoot);

  const nodePtyRoot = path.join(packagingRoot, "node_modules", "node-pty");
  const helpers = ensureSpawnHelpersExecutable(nodePtyRoot, "darwin");
  if (helpers.length === 0) {
    throw new Error(`No macOS node-pty spawn-helper found under ${nodePtyRoot}`);
  }
}

export function removeDesktopSelfReferences(deployRoot) {
  const selfReferences = [
    path.join(deployRoot, "node_modules", "@agent-resume", "desktop"),
    path.join(deployRoot, "node_modules", ".pnpm", "node_modules", "@agent-resume", "desktop")
  ];
  for (const selfReference of selfReferences) {
    fs.rmSync(selfReference, { recursive: true, force: true });
  }
}

export async function packMacApp() {
  if (process.platform !== "darwin") {
    throw new Error("pack:mac is only supported on macOS.");
  }
  if (!fs.existsSync(iconPath)) {
    throw new Error(`Missing app icon: ${iconPath}. Run pnpm run build first.`);
  }
  deployDesktop();
  const electronZipDir = await ensureElectronZipDir();
  console.log("Packaging macOS .app...");
  fs.rmSync(releaseRoot, { recursive: true, force: true });
  const packagerArgs = [
    "exec",
    "electron-packager",
    packagingRoot,
    "Agent Resume",
    `--platform=darwin`,
    `--arch=${targetArch}`,
    `--app-bundle-id=${bundleId}`,
    "--app-category-type=public.app-category.developer-tools",
    `--icon=${iconPath}`,
    `--out=${releaseRoot}`,
    `--electron-zip-dir=${electronZipDir}`,
    "--overwrite",
    "--asar.unpackDir=node_modules/node-pty",
    "--osx-universal.x64ArchFiles=**/node-pty/prebuilds/**",
    "--no-prune"
  ];
  await withRetry("electron-packager", PACKAGER_ATTEMPTS, () => {
    execFileSync("pnpm", packagerArgs, {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "" }
    });
  });
  const appBundle = findAppBundle();
  if (!appBundle) {
    throw new Error("Packaging finished but Agent Resume.app was not found under release/");
  }
  signMacApp(appBundle);
  fs.writeFileSync(
    stampFile,
    JSON.stringify({ version: 1, arch: targetArch, bundleId, sourceMtime: latestRepackMtime() })
  );
  return appBundle;
}

export function stageMacDmgContents(appBundle, stagingDir) {
  if (!appBundle || !fs.existsSync(appBundle)) {
    throw new Error(`Missing app bundle: ${appBundle}`);
  }
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(stagingDir, { recursive: true });
  fs.cpSync(appBundle, path.join(stagingDir, path.basename(appBundle)), {
    recursive: true,
    preserveTimestamps: true,
    verbatimSymlinks: true
  });
  fs.symlinkSync("/Applications", path.join(stagingDir, "Applications"), "dir");
}

export function createMacDmg(appBundle) {
  if (process.platform !== "darwin") {
    throw new Error("DMG packaging is only supported on macOS.");
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const dmgName = `Agent Resume-${pkg.version}.dmg`;
  const dmgPath = path.join(releaseRoot, dmgName);
  const dmgStagingDir = path.join(releaseRoot, "dmg-root");
  fs.rmSync(dmgPath, { force: true });
  console.log("Creating DMG...");
  stageMacDmgContents(appBundle, dmgStagingDir);
  try {
    execFileSync(
      "hdiutil",
      ["create", "-volname", "Agent Resume", "-srcfolder", dmgStagingDir, "-ov", "-format", "UDZO", dmgPath],
      { stdio: "inherit" }
    );
  } finally {
    fs.rmSync(dmgStagingDir, { recursive: true, force: true });
  }
  return dmgPath;
}
