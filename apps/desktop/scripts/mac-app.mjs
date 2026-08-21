import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { downloadArtifact } from "@electron/get";
import { packager } from "@electron/packager";
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
const bundleId = "com.thunder-luc.agent-resume";

export const macTargetArches = ["x64", "arm64"];

export const desktopRoot = root;

export function appBundlePathFor(arch) {
  return path.join(releaseRoot, `Agent Resume-darwin-${arch}`, "Agent Resume.app");
}

export function runDesktopBuild() {
  execFileSync("pnpm", ["run", "build"], { cwd: root, stdio: "inherit" });
}

export function findAppBundle(arch) {
  return fs.existsSync(appBundlePathFor(arch)) ? appBundlePathFor(arch) : null;
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

const stampFileFor = (arch) => path.join(root, `.dev-app-stamp-${arch}`);

export function isBuildStampCurrent(rawStamp, sourceMtime, arch) {
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

export function needsRepack(arch) {
  const appBundle = findAppBundle(arch);
  if (!appBundle) return true;
  const stampFile = stampFileFor(arch);
  if (!fs.existsSync(stampFile)) return true;
  return !isBuildStampCurrent(fs.readFileSync(stampFile, "utf8"), latestRepackMtime(), arch);
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

async function ensureElectronZipDir(arch) {
  const version = installedElectronVersion();
  const zipDir = electronZipDirForVersion(version);
  fs.mkdirSync(zipDir, { recursive: true });

  const fileName = `electron-v${version}-darwin-${arch}.zip`;
  const dest = path.join(zipDir, fileName);
  if (fs.existsSync(dest)) return zipDir;

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

  return zipDir;
}

function deployDesktop() {
  fs.rmSync(packagingRoot, { recursive: true, force: true });
  const workspaceStatePath = path.join(repoRoot, "node_modules", ".pnpm-workspace-state-v1.json");
  const savedState = fs.existsSync(workspaceStatePath) ? fs.readFileSync(workspaceStatePath, "utf8") : null;
  try {
    execFileSync(
      "pnpm",
      ["--filter", "@agent-resume/desktop", "--prod", "deploy", "--legacy", packagingRoot],
      {
        cwd: repoRoot,
        stdio: "inherit",
        // Non-interactive deploy: allow purging staging node_modules without a TTY.
        env: { ...process.env, CI: process.env.CI || "true" }
      }
    );
  } finally {
    if (savedState !== null) {
      fs.writeFileSync(workspaceStatePath, savedState);
    }
  }

  removeDesktopSelfReferences(packagingRoot);
  // electron-packager/asar follows package symlinks and drops pnpm's isolated
  // sibling dependency layout. Materialize a classic flat node_modules first.
  flattenDeployedNodeModulesForAsar(packagingRoot);

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

/**
 * Parse a pnpm package-map key into a package name.
 * Examples:
 *   "@modelcontextprotocol/sdk@1.29.0(zod@4.4.3)" -> "@modelcontextprotocol/sdk"
 *   "zod@4.4.3" -> "zod"
 *   "@agent-resume/core@file:packages/core" -> "@agent-resume/core"
 *   "." / "packages/core" / "apps/desktop" -> null
 */
export function packageNameFromMapKey(key) {
  if (!key || key === ".") {
    return null;
  }
  // Workspace path keys from the monorepo lockfile (not installable package names).
  if (key.startsWith("packages/") || key.startsWith("apps/")) {
    return null;
  }
  if (key.startsWith("@")) {
    const match = /^(@[^/]+\/[^@/]+)/.exec(key);
    return match ? match[1] : null;
  }
  // Bare workspace-style paths like "scripts/foo" should not be treated as packages.
  if (key.includes("/") && !key.includes("@")) {
    return null;
  }
  const at = key.indexOf("@");
  return at > 0 ? key.slice(0, at) : key;
}

function packageTargetPath(nodeModulesRoot, packageName) {
  return path.join(nodeModulesRoot, ...packageName.split("/"));
}

function isPnpmVirtualStoreUrl(url) {
  const normalized = url.replace(/\\/g, "/");
  return normalized === "./.pnpm" || normalized.startsWith("./.pnpm/") || normalized.startsWith(".pnpm/");
}

/**
 * Rewrite pnpm isolated deploy layout into a classic flat node_modules tree.
 * Without this, Electron asar packaging dereferences top-level package symlinks
 * and Node can no longer resolve transitive deps such as
 * `@modelcontextprotocol/sdk` from `@agent-resume/core`.
 */
export function flattenDeployedNodeModulesForAsar(deployRoot) {
  const nodeModulesRoot = path.join(deployRoot, "node_modules");
  const packageMapPath = path.join(nodeModulesRoot, ".package-map.json");
  if (!fs.existsSync(packageMapPath)) {
    return;
  }

  const packageMap = JSON.parse(fs.readFileSync(packageMapPath, "utf8"));
  const packages = packageMap.packages ?? packageMap;
  /** @type {Map<string, string>} */
  const sourcesByName = new Map();

  for (const [key, meta] of Object.entries(packages)) {
    const name = packageNameFromMapKey(key);
    if (!name || !meta?.url || !isPnpmVirtualStoreUrl(meta.url)) continue;
    const source = path.resolve(nodeModulesRoot, meta.url);
    if (!fs.existsSync(source)) continue;
    // Prefer the first real path; deploy maps usually have one version per name.
    if (!sourcesByName.has(name)) {
      sourcesByName.set(name, source);
    }
  }

  for (const [name, source] of sourcesByName) {
    const target = packageTargetPath(nodeModulesRoot, name);
    const realSource = fs.realpathSync(source);
    // Never copy a path onto itself or into a subdirectory of the source.
    const resolvedTarget = path.resolve(target);
    if (resolvedTarget === realSource || resolvedTarget.startsWith(`${realSource}${path.sep}`)) {
      continue;
    }
    if (realSource === path.resolve(deployRoot) || realSource.startsWith(`${path.resolve(deployRoot)}${path.sep}`)) {
      // Source inside deploy root but outside .pnpm is unexpected after the url filter;
      // still guard against copying the deploy tree into itself.
      if (!realSource.includes(`${path.sep}.pnpm${path.sep}`)) {
        continue;
      }
    }
    if (fs.existsSync(target)) {
      const stat = fs.lstatSync(target);
      if (!stat.isSymbolicLink() && path.resolve(target) === realSource) {
        continue;
      }
      fs.rmSync(target, { recursive: true, force: true });
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(realSource, target, { recursive: true, dereference: true });
  }

  // Drop the virtual store so asar only ships the classic tree.
  const pnpmStore = path.join(nodeModulesRoot, ".pnpm");
  if (fs.existsSync(pnpmStore)) {
    fs.rmSync(pnpmStore, { recursive: true, force: true });
  }
  for (const metaName of [".package-map.json", ".modules.yaml"]) {
    const metaPath = path.join(nodeModulesRoot, metaName);
    if (fs.existsSync(metaPath)) {
      fs.rmSync(metaPath, { force: true });
    }
  }
}

export async function packMacApp(arch) {
  if (process.platform !== "darwin") {
    throw new Error("pack:mac is only supported on macOS.");
  }
  if (!macTargetArches.includes(arch)) {
    throw new Error(`Unsupported arch: ${arch}. Expected one of: ${macTargetArches.join(", ")}`);
  }
  if (!fs.existsSync(iconPath)) {
    throw new Error(`Missing app icon: ${iconPath}. Run pnpm run build first.`);
  }
  deployDesktop();
  const electronZipDir = await ensureElectronZipDir(arch);
  console.log(`Packaging macOS ${arch} .app...`);
  // Remove stale artifacts for this arch only; keep other arches' outputs.
  fs.rmSync(path.dirname(appBundlePathFor(arch)), { recursive: true, force: true });
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  fs.rmSync(path.join(releaseRoot, `Agent Resume-${pkg.version}-${arch}.dmg`), { force: true });
  await withRetry("electron-packager", PACKAGER_ATTEMPTS, () =>
    packager({
      dir: packagingRoot,
      name: "Agent Resume",
      platform: "darwin",
      arch,
      appBundleId: bundleId,
      appCategoryType: "public.app-category.developer-tools",
      icon: iconPath,
      out: releaseRoot,
      electronZipDir,
      overwrite: true,
      asar: {
        unpackDir: "node_modules/node-pty"
      },
      prune: false
    })
  );
  const appBundle = findAppBundle(arch);
  if (!appBundle) {
    throw new Error(`Packaging finished but Agent Resume.app was not found for ${arch} under release/`);
  }
  signMacApp(appBundle);
  fs.writeFileSync(
    stampFileFor(arch),
    JSON.stringify({ version: 1, arch, bundleId, sourceMtime: latestRepackMtime() })
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

export function createMacDmg(appBundle, arch) {
  if (process.platform !== "darwin") {
    throw new Error("DMG packaging is only supported on macOS.");
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const dmgName = `Agent Resume-${pkg.version}-${arch}.dmg`;
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
