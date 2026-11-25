import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { cp, mkdtemp, rename, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const DEFAULT_EDITORS = ["code", "cursor", "codium", "antigravity-ide"];
const EDITOR_HINTS = {
  code: 'Install VS Code shell command: "Shell Command: Install \'code\' command in PATH"',
  cursor: "Ensure the Cursor CLI is on PATH.",
  codium: "Ensure the VSCodium CLI (codium) is on PATH.",
  "antigravity-ide": "Ensure Antigravity IDE is installed or install its shell command ('antigravity-ide') in PATH.",
  antigravity: "Ensure Antigravity IDE is installed or install its shell command ('antigravity-ide') in PATH."
};
const ANTIGRAVITY_FALLBACK_PATHS = [
  "/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide",
  join(homedir(), "Applications", "Antigravity IDE.app", "Contents", "Resources", "app", "bin", "antigravity-ide")
];
const EDITOR_FALLBACK_PATHS = {
  "antigravity-ide": ANTIGRAVITY_FALLBACK_PATHS,
  antigravity: ANTIGRAVITY_FALLBACK_PATHS
};

const options = parseArgs(process.argv.slice(2));

const manifest = await import("../package.json", { with: { type: "json" } });
const pkg = manifest.default;
const extensionId = `${pkg.publisher}.${pkg.name}`;
const extensionDirName = `${extensionId}-${pkg.version}`;
const vsixPath = join(import.meta.dirname, "..", "dist", `${pkg.name}-${pkg.version}.vsix`);

if (!existsSync(vsixPath)) {
  throw new Error(`VSIX not found: ${vsixPath}`);
}

const installedEditors = installWithEditorCli(vsixPath, options.editors, options.requireAll);
if (installedEditors.length > 0) {
  console.log(`Installed to: ${installedEditors.join(", ")}`);
  console.log("Run 'Developer: Reload Window' in each editor to reload extension contributions.");
  process.exit(0);
}

if (options.editors) {
  throw new Error(`No requested editor CLI installed the extension (${options.editors.join(", ")}).`);
}

await installIntoVscodeOssExtensions(vsixPath, extensionDirName, extensionId);

function parseArgs(argv) {
  const options = {
    editors: null,
    requireAll: false
  };

  for (const arg of argv) {
    if (arg === "--require-all" || arg === "--strict") {
      options.requireAll = true;
    } else if (arg.startsWith("--editors=")) {
      const value = arg.slice("--editors=".length).trim();
      if (!value) {
        throw new Error("Missing value for --editors");
      }
      options.editors = value.split(",").map((item) => item.trim()).filter(Boolean);
      if (options.editors.length === 0) {
        throw new Error("At least one editor is required for --editors");
      }
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function installWithEditorCli(vsix, editors, requireAll) {
  const targets = editors ?? DEFAULT_EDITORS;
  const installed = [];

  for (const command of targets) {
    const resolved = resolveEditorCommand(command);
    if (!resolved) {
      if (requireAll) {
        const hint = EDITOR_HINTS[command] ?? `Ensure the ${command} CLI is on PATH.`;
        throw new Error(`${command} CLI not found. ${hint}`);
      }
      continue;
    }

    execFileSync(resolved, ["--install-extension", vsix, "--force"], { stdio: "inherit" });
    installed.push(command);
  }

  return installed;
}

function resolveEditorCommand(command) {
  if (hasCommand(command)) {
    return command;
  }
  if (command === "antigravity" && hasCommand("antigravity-ide")) {
    return "antigravity-ide";
  }
  for (const candidate of EDITOR_FALLBACK_PATHS[command] ?? []) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
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