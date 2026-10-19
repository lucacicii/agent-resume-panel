import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { packager } from "@electron/packager";
import { ensureSpawnHelpersExecutable } from "./fix-node-pty.mjs";
import {
  bundleId,
  deployDesktop,
  desktopRoot,
  ensureElectronZipDir,
  packagedAppPath,
  packagingRoot,
  releaseRoot,
  runDesktopBuild,
  withRetry
} from "./pack-common.mjs";
export {
  deployDesktop,
  flattenDeployedNodeModulesForAsar,
  packageNameFromMapKey,
  removeDesktopSelfReferences
} from "./pack-common.mjs";
import {
  assertBundledDaemon,
  bundledDaemonPath,
  bundledTuiPath,
  stageThunderSidecar,
  stageThunderTui,
  thunderResourcePaths
} from "./thunder-sidecar.mjs";

const PACKAGER_ATTEMPTS = 3;

const root = desktopRoot;
const iconPath = path.join(root, "dist", "resources", "icon.icns");

export const macTargetArches = ["x64", "arm64"];

export { runDesktopBuild };

export function appBundlePathFor(arch) {
  return packagedAppPath("Agent Resume", "darwin", arch);
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

export function isBuildStampCurrent(rawStamp, sourceMtime, arch, bundleThunder = false) {
  try {
    const stamp = JSON.parse(rawStamp);
    return (
      stamp?.version === 1 &&
      stamp.arch === arch &&
      stamp.bundleId === bundleId &&
      // A dev pack (no daemon) must not be reused as a release pack, and vice versa.
      Boolean(stamp.bundleThunder) === bundleThunder &&
      stamp.sourceMtime >= sourceMtime
    );
  } catch {
    return false;
  }
}

export function needsRepack(arch, bundleThunder = false) {
  const appBundle = findAppBundle(arch);
  if (!appBundle) return true;
  const stampFile = stampFileFor(arch);
  if (!fs.existsSync(stampFile)) return true;
  return !isBuildStampCurrent(fs.readFileSync(stampFile, "utf8"), latestRepackMtime(), arch, bundleThunder);
}

function signMacApp(appBundle) {
  const identity = process.env.AGENT_RESUME_CODESIGN_IDENTITY || "-";
  console.log(`Signing macOS app with identity: ${identity}`);
  execFileSync("codesign", ["--force", "--deep", "--sign", identity, appBundle], {
    cwd: root,
    stdio: "inherit"
  });
}

/**
 * Sign the embedded Thunder daemon on its own before the bundle is signed.
 * `--deep` would usually reach it, but nested binaries are exactly what notarization
 * rejects, and a real identity also wants hardened runtime + a secure timestamp.
 */
function signEmbeddedThunder(appBundle) {
  const binaries = [bundledDaemonPath(appBundle), bundledTuiPath(appBundle)].filter((binary) => fs.existsSync(binary));
  if (!binaries.length) return;
  const identity = process.env.AGENT_RESUME_CODESIGN_IDENTITY || "-";
  const adHoc = identity === "-";
  for (const binary of binaries) {
    const args = [
      "--force",
      "--sign",
      identity,
      ...(adHoc ? [] : ["--options", "runtime", "--timestamp"]),
      binary
    ];
    console.log(`Signing bundled Thunder binary ${path.basename(binary)} (${adHoc ? "ad-hoc" : identity})`);
    execFileSync("codesign", args, { cwd: root, stdio: "inherit" });
  }
}


export async function packMacApp(arch, { bundleThunder = false } = {}) {
  if (process.platform !== "darwin") {
    throw new Error("pack:mac is only supported on macOS.");
  }
  if (!macTargetArches.includes(arch)) {
    throw new Error(`Unsupported arch: ${arch}. Expected one of: ${macTargetArches.join(", ")}`);
  }
  if (!fs.existsSync(iconPath)) {
    throw new Error(`Missing app icon: ${iconPath}. Run pnpm run build first.`);
  }
  // Release builds embed the Thunder daemon; `dev:mac` deliberately does not, so a
  // developer's live checkout is never shadowed by a stale packaged copy.
  const requireThunder = process.env.AGENT_RESUME_REQUIRE_THUNDER === "1";
  const sidecar = bundleThunder
    ? stageThunderSidecar(arch, { require: requireThunder })
    : null;
  // The TUI ships beside the daemon so `cli:thunder` works in a packaged app.
  if (sidecar?.ok) stageThunderTui(arch, { require: requireThunder });
  deployDesktop();
  const nodePtyRoot = path.join(packagingRoot, "node_modules", "node-pty");
  const helpers = ensureSpawnHelpersExecutable(nodePtyRoot, "darwin");
  if (helpers.length === 0) {
    throw new Error(`No macOS node-pty spawn-helper found under ${nodePtyRoot}`);
  }
  const electronZipDir = await ensureElectronZipDir("darwin", arch);
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
      // Lands at Contents/Resources/thunder/bin/{thunder-daemon,thunder-tui}.
      ...(thunderResourcePaths(sidecar).length ? { extraResource: thunderResourcePaths(sidecar) } : {}),
      prune: false
    })
  );
  const appBundle = findAppBundle(arch);
  if (!appBundle) {
    throw new Error(`Packaging finished but Agent Resume.app was not found for ${arch} under release/`);
  }
  if (sidecar?.ok) {
    const bundled = assertBundledDaemon(appBundle);
    signEmbeddedThunder(appBundle);
    console.log(`Bundled Thunder daemon: ${bundled}`);
  }
  signMacApp(appBundle);
  // Records what the bundle actually contains, not what was requested: an arch whose
  // daemon could not be staged must not look like a complete release pack.
  const thunderBundled = Boolean(sidecar?.ok);
  fs.writeFileSync(
    stampFileFor(arch),
    JSON.stringify({ version: 1, arch, bundleId, sourceMtime: latestRepackMtime(), bundleThunder: thunderBundled })
  );
  return { appBundle, thunderBundled, thunderSource: sidecar?.ok ? sidecar.source : null };
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
