import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { cp, mkdtemp, rename, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const manifest = await import("../package.json", { with: { type: "json" } });
const pkg = manifest.default;
const extensionId = `${pkg.publisher}.${pkg.name}`;
const extensionDirName = `${extensionId}-${pkg.version}`;
const vsixPath = join(import.meta.dirname, "..", "dist", `${pkg.name}-${pkg.version}.vsix`);

if (!existsSync(vsixPath)) {
  throw new Error(`VSIX not found: ${vsixPath}`);
}

const installedEditors = installWithEditorCli(vsixPath);
if (installedEditors.length > 0) {
  console.log(`Installed to: ${installedEditors.join(", ")}`);
  console.log("Run 'Developer: Reload Window' in each editor to reload extension contributions.");
  process.exit(0);
}

await installIntoVscodeOssExtensions(vsixPath, extensionDirName, extensionId);

function installWithEditorCli(vsix) {
  const installed = [];
  for (const command of ["code", "cursor", "codium"]) {
    if (!hasCommand(command)) {
      continue;
    }

    execFileSync(command, ["--install-extension", vsix, "--force"], { stdio: "inherit" });
    installed.push(command);
  }

  return installed;
}

function hasCommand(command) {
  try {
    execFileSync("command", ["-v", command], { shell: true, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function installIntoVscodeOssExtensions(vsix, extensionDir, id) {
  const extensionsRoot = join(homedir(), ".vscode-oss", "extensions");
  const installPath = join(extensionsRoot, extensionDir);
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-resume-panel-vsix-"));
  const unpacked = join(tempRoot, "extension");

  mkdirSync(extensionsRoot, { recursive: true });
  rmSync(installPath, { recursive: true, force: true });

  try {
    execFileSync("unzip", ["-q", vsix, "-d", tempRoot], { stdio: "inherit" });
    await rename(unpacked, installPath);
    await cp(join(tempRoot, "extension.vsixmanifest"), join(installPath, ".vsixmanifest"));
    console.log(`Installed ${id} to ${installPath}`);
    console.log("Run 'Developer: Reload Window' in VS Code/ZCode to reload extension contributions.");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}