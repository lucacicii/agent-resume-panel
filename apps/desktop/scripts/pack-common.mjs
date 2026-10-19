/**
 * Platform-independent half of the desktop packer.
 *
 * `mac-app.mjs` keeps everything that is genuinely macOS (codesign, DMG,
 * `.icns`), and `pack-win.mjs` adds everything that is genuinely Windows
 * (Authenticode, `.ico`, NSIS/zip). The staging steps in between — pnpm deploy,
 * flattening the isolated store, staging Thunder, resolving the Electron zip —
 * are the same on both platforms and live here so the two entry points cannot
 * drift apart.
 *
 * Nothing in this module may assume `process.platform === "darwin"`.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { downloadArtifact } from "@electron/get";

const require = createRequire(import.meta.url);
const DOWNLOAD_ATTEMPTS = 4;
const RETRY_DELAY_MS = 2000;

export const desktopRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const releaseRoot = path.join(desktopRoot, "release");
export const packagingRoot = path.join(desktopRoot, ".pack-staging");
export const repoRoot = path.join(desktopRoot, "..", "..");
export const bundleId = "com.thunder-luc.agent-resume";

/** Directory name electron-packager gives an app for a platform/arch pair. */
export function packagedDirName(name, platform, arch) {
  return `${name}-${platform}-${arch}`;
}

/** Where the packager puts the app for a platform/arch pair. */
export function packagedAppPath(name, platform, arch) {
  const dir = path.join(releaseRoot, packagedDirName(name, platform, arch));
  if (platform === "darwin") return path.join(dir, `${name}.app`);
  if (platform === "win32") return path.join(dir, `${name}.exe`);
  return dir;
}

export function installedElectronVersion() {
  return require("electron/package.json").version;
}

export function electronZipDirForVersion(version = installedElectronVersion()) {
  return path.join(desktopRoot, ".electron-zips", `v${version}`);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry(label, attempts, fn) {
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

/**
 * Download (once) the Electron distribution zip for a platform/arch pair.
 *
 * electron-packager is pointed at the directory rather than a file: it picks
 * the `electron-v<version>-<platform>-<arch>.zip` it needs from there.
 */
export async function ensureElectronZipDir(platform, arch) {
  const version = installedElectronVersion();
  const zipDir = electronZipDirForVersion(version);
  fs.mkdirSync(zipDir, { recursive: true });

  const fileName = `electron-v${version}-${platform}-${arch}.zip`;
  const dest = path.join(zipDir, fileName);
  if (fs.existsSync(dest)) return zipDir;

  console.log(`Fetching Electron ${version} ${platform}-${arch}...`);
  const cached = await withRetry(`Electron ${platform}-${arch} download`, DOWNLOAD_ATTEMPTS, () =>
    downloadArtifact({
      version,
      platform,
      arch,
      artifactName: "electron"
    })
  );
  fs.copyFileSync(cached, dest);

  return zipDir;
}

export function runDesktopBuild() {
  execFileSync(pnpmCommand(), ["run", "build"], {
    cwd: desktopRoot,
    stdio: "inherit",
    shell: process.platform === "win32"
  });
}

/** `pnpm` is a `.cmd` shim on Windows, so it needs a shell to start. */
export function pnpmCommand() {
  return "pnpm";
}

export function runPnpm(args, options = {}) {
  execFileSync(pnpmCommand(), args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options
  });
}

/**
 * `pnpm deploy` the desktop package into `.pack-staging`, then normalize the
 * layout so electron-packager/asar can follow it.
 */
export function deployDesktop() {
  fs.rmSync(packagingRoot, { recursive: true, force: true });
  const workspaceStatePath = path.join(repoRoot, "node_modules", ".pnpm-workspace-state-v1.json");
  const savedState = fs.existsSync(workspaceStatePath) ? fs.readFileSync(workspaceStatePath, "utf8") : null;
  try {
    runPnpm(
      ["--filter", "@agent-resume/desktop", "--prod", "deploy", "--legacy", packagingRoot],
      {
        cwd: repoRoot,
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

/**
 * The node-pty binary that must exist for a platform/arch pair.
 *
 * POSIX builds use `spawn-helper`; Windows builds use the ConPTY addon. Both
 * live in `prebuilds/` and both must stay outside the asar archive.
 */
export function nodePtyBinaryPath(nodePtyRoot, platform, arch) {
  const prebuild = path.join(nodePtyRoot, "prebuilds", `${platform}-${arch}`);
  if (platform === "win32") {
    return path.join(prebuild, "pty.node");
  }
  return path.join(prebuild, "spawn-helper");
}

export function assertNodePtyPrebuild(nodePtyRoot, platform, arch) {
  const binary = nodePtyBinaryPath(nodePtyRoot, platform, arch);
  if (!fs.existsSync(binary)) {
    throw new Error(
      `node-pty has no ${platform}-${arch} prebuild (expected ${binary}). ` +
        "Run pnpm install with the target platform in mind, or check node-pty's prebuilds directory."
    );
  }
  return binary;
}

/** Timestamp of the newest file that goes into a packaged app. */
export function latestSourceMtime() {
  let latest = 0;
  const visit = (target) => {
    let stat;
    try {
      stat = fs.statSync(target);
    } catch {
      return;
    }
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(target)) {
        if (entry === "node_modules" || entry === "release" || entry === ".pack-staging" || entry === ".electron-zips") {
          continue;
        }
        visit(path.join(target, entry));
      }
      return;
    }
    if (stat.mtimeMs > latest) latest = stat.mtimeMs;
  };
  visit(path.join(desktopRoot, "dist"));
  visit(path.join(repoRoot, "packages", "core", "dist"));
  return latest;
}
