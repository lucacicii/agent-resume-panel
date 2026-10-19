/**
 * Windows desktop packaging: `pnpm run pack:win`.
 *
 * Produces, per arch, an unpacked `release/Agent Resume-win32-<arch>/` plus a
 * portable `.zip`. An installer is opt-in (`AGENT_RESUME_WIN_INSTALLER=nsis`)
 * because it needs a toolchain (NSIS) that is not a Node dependency.
 *
 * Signing is Authenticode: set `WINDOWS_CERTIFICATE_FILE` and
 * `WINDOWS_CERTIFICATE_PASSWORD` (or `WINDOWS_CERTIFICATE_SHA1` for a
 * certificate already in the store) and the packager signs the app and the
 * embedded Thunder binaries.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packager } from "@electron/packager";
import {
  assertNodePtyPrebuild,
  bundleId,
  deployDesktop,
  desktopRoot,
  ensureElectronZipDir,
  latestSourceMtime,
  packagedAppPath,
  packagingRoot,
  releaseRoot,
  runDesktopBuild,
  withRetry
} from "./pack-common.mjs";
import {
  stageThunderSidecar,
  stageThunderTui,
  thunderResourcePaths
} from "./thunder-sidecar.mjs";

const PACKAGER_ATTEMPTS = 3;
const APP_NAME = "Agent Resume";

export const winTargetArches = ["x64", "arm64"];

export function winAppPathFor(arch) {
  return packagedAppPath(APP_NAME, "win32", arch);
}

export function winZipPathFor(arch, version) {
  return path.join(releaseRoot, `${APP_NAME}-${version}-win32-${arch}.zip`);
}

function stampFileFor(arch) {
  return path.join(desktopRoot, `.dev-app-stamp-win32-${arch}`);
}

function iconPath() {
  return path.join(desktopRoot, "dist", "resources", "icon.ico");
}

function signingOptions() {
  const certificateFile = process.env.WINDOWS_CERTIFICATE_FILE?.trim();
  const certificatePassword = process.env.WINDOWS_CERTIFICATE_PASSWORD;
  const certificateSha1 = process.env.WINDOWS_CERTIFICATE_SHA1?.trim();
  if (!certificateFile && !certificateSha1) return {};

  return {
    windowsSign: {
      ...(certificateFile ? { certificateFile } : {}),
      ...(certificatePassword ? { certificatePassword } : {}),
      ...(certificateSha1 ? { certificateSha1 } : {}),
      // A timestamp is what keeps signatures valid after the certificate expires.
      timestampServer: process.env.WINDOWS_TIMESTAMP_SERVER || "http://timestamp.digicert.com"
    }
  };
}

/**
 * Pack one arch.
 *
 * `win32metadata` is what gives the executable its product name, company and
 * description; without it Windows shows the internal package name in Task
 * Manager, in the Start menu, and in toast notifications.
 */
export async function packWinApp(arch, { bundleThunder = false } = {}) {
  if (!winTargetArches.includes(arch)) {
    throw new Error(`Unsupported arch: ${arch}. Expected one of: ${winTargetArches.join(", ")}`);
  }
  const icon = iconPath();
  if (!fs.existsSync(icon)) {
    throw new Error(`Missing app icon: ${icon}. Run pnpm run build first (copy-renderer generates icon.ico).`);
  }

  const requireThunder = process.env.AGENT_RESUME_REQUIRE_THUNDER === "1";
  const sidecar = bundleThunder ? stageThunderSidecar(arch, { require: requireThunder }) : null;
  if (sidecar?.ok) stageThunderTui(arch, { require: requireThunder });

  deployDesktop();
  const nodePtyRoot = path.join(packagingRoot, "node_modules", "node-pty");
  assertNodePtyPrebuild(nodePtyRoot, "win32", arch);

  const electronZipDir = await ensureElectronZipDir("win32", arch);
  const outputDir = path.dirname(winAppPathFor(arch));
  fs.rmSync(outputDir, { recursive: true, force: true });

  const pkg = JSON.parse(fs.readFileSync(path.join(desktopRoot, "package.json"), "utf8"));

  await withRetry("electron-packager", PACKAGER_ATTEMPTS, () =>
    packager({
      dir: packagingRoot,
      name: APP_NAME,
      platform: "win32",
      arch,
      icon,
      out: releaseRoot,
      electronZipDir,
      overwrite: true,
      asar: {
        // Native addon + ConPTY agent + DLLs cannot be read from inside asar.
        unpackDir: "node_modules/node-pty"
      },
      ...(thunderResourcePaths(sidecar).length ? { extraResource: thunderResourcePaths(sidecar) } : {}),
      win32metadata: {
        CompanyName: "Agent Resume",
        FileDescription: "Agent Resume Desktop",
        ProductName: APP_NAME,
        // Taskbar grouping and toast notifications key off this id; it must
        // match app.setAppUserModelId in main.ts.
        AppUserModelId: bundleId
      },
      ...signingOptions(),
      prune: false
    })
  );

  const appPath = winAppPathFor(arch);
  if (!fs.existsSync(appPath)) {
    throw new Error(`Packaging finished but ${appPath} was not found under release/`);
  }

  fs.writeFileSync(
    stampFileFor(arch),
    JSON.stringify({
      version: 1,
      platform: "win32",
      arch,
      bundleId,
      sourceMtime: latestSourceMtime(),
      bundleThunder: Boolean(sidecar?.ok)
    })
  );

  return {
    appPath,
    version: pkg.version,
    thunderBundled: Boolean(sidecar?.ok),
    thunderSource: sidecar?.ok ? sidecar.source : null
  };
}

/** Zip the unpacked app; `Compress-Archive` ships with every supported Windows. */
export function createPortableZip(appPath, arch, version) {
  const zipPath = winZipPathFor(arch, version);
  fs.rmSync(zipPath, { force: true });
  const parent = path.dirname(appPath);
  const folder = path.basename(parent);
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `Compress-Archive -Path '${parent.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`
  ].join("; ");
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    stdio: "inherit"
  });
  console.log(`Portable zip (${arch}): ${zipPath} (${folder})`);
  return zipPath;
}

/**
 * Optional NSIS installer.
 *
 * Requires `makensis` on PATH. The script is generated rather than shipped so
 * the product name, version and app id stay in one place.
 */
export function createNsisInstaller(appPath, arch, version) {
  const nsis = process.env.MAKENSIS_PATH || "makensis";
  const output = path.join(releaseRoot, `${APP_NAME}-${version}-win32-${arch}-setup.exe`);
  const scriptPath = path.join(releaseRoot, `.nsis-${arch}.nsi`);
  const folder = path.basename(path.dirname(appPath));
  const script = `
Unicode true
!include "MUI2.nsh"
Name "${APP_NAME}"
OutFile "${output}"
InstallDir "$LOCALAPPDATA\\Programs\\${APP_NAME}"
RequestExecutionLevel user
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
Section "Install"
  SetOutPath "$INSTDIR"
  File /r "${path.dirname(appPath)}\\*.*"
  CreateShortcut "$SMPROGRAMS\\${APP_NAME}.lnk" "$INSTDIR\\${APP_NAME}.exe"
  WriteUninstaller "$INSTDIR\\Uninstall.exe"
SectionEnd
Section "Uninstall"
  RMDir /r "$INSTDIR"
  Delete "$SMPROGRAMS\\${APP_NAME}.lnk"
SectionEnd
`.trim();
  fs.writeFileSync(scriptPath, script, "utf8");
  try {
    execFileSync(nsis, [scriptPath], { stdio: "inherit" });
  } finally {
    fs.rmSync(scriptPath, { force: true });
  }
  console.log(`Installer (${arch}): ${output} (from ${folder})`);
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arches = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  const targets = arches.length ? arches : winTargetArches;
  runDesktopBuild();
  const results = [];
  for (const arch of targets) {
    const result = await packWinApp(arch, { bundleThunder: true });
    const zipPath = createPortableZip(result.appPath, arch, result.version);
    let installer = null;
    if (process.env.AGENT_RESUME_WIN_INSTALLER === "nsis") {
      installer = createNsisInstaller(result.appPath, arch, result.version);
    }
    console.log(`\nPackaged (${arch}): ${result.appPath}`);
    console.log(`Portable zip (${arch}): ${zipPath}`);
    results.push({ ...result, zipPath, installer });
  }

  const withoutDaemon = results.filter((entry) => !entry.thunderBundled);
  if (withoutDaemon.length) {
    console.warn([
      "",
      "──────────────────────────────────────────────────────────────────────",
      `WARNING: ${withoutDaemon.length} of ${results.length} Windows builds have no Thunder daemon:`,
      ...withoutDaemon.map((entry) => `  · ${entry.arch}: ${entry.appPath}`),
      "Chat in those builds only works on machines with a thunder checkout or a",
      "configured daemon path. Re-run with AGENT_RESUME_REQUIRE_THUNDER=1 to fail instead.",
      "──────────────────────────────────────────────────────────────────────"
    ].join("\n"));
  }
}
