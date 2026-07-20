import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { ensureElectron, resolveElectronPath } from "./ensure-electron.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.join(root, "..", "..");
const require = createRequire(import.meta.url);

const cliArgs = process.argv.slice(2);
const fresh = cliArgs.includes("--fresh");
const noWatch = cliArgs.includes("--no-watch");

const coreDistEntry = path.join(repoRoot, "packages", "core", "dist", "index.js");
const mainDistEntry = path.join(root, "dist", "main", "main.js");
const tscBin = require.resolve("typescript/bin/tsc");
const corepackBin = path.join(
  path.dirname(process.execPath),
  process.platform === "win32" ? "corepack.cmd" : "corepack"
);
const pnpmLauncher = fs.existsSync(corepackBin)
  ? { command: corepackBin, args: ["pnpm"] }
  : { command: "pnpm", args: [] };
const pnpmEnv = { ...process.env, PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: "false" };

const children = [];
let electronApp = null;
let shuttingDown = false;

function devEnv() {
  const env = { ...process.env, AGENT_RESUME_DEV: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function trackChild(child) {
  children.push(child);
  child.on("error", (error) => {
    console.error(`[dev] failed to spawn process: ${error.message}`);
    shutdown(1);
  });
  return child;
}

function spawnTracked(command, args, options = {}) {
  return trackChild(
    spawn(command, args, {
      cwd: options.cwd || root,
      stdio: "inherit",
      env: options.env || process.env,
      shell: false
    })
  );
}

function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  const finish = () => {
    for (const child of children) {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    }
    process.exit(code);
  };

  if (electronApp) {
    electronApp.destroy().finally(finish);
    return;
  }

  finish();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

function runWorkspaceScript(workspace, script) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      pnpmLauncher.command,
      [...pnpmLauncher.args, "--filter", workspace, "run", script],
      {
        cwd: repoRoot,
        stdio: "inherit",
        env: pnpmEnv,
        shell: process.platform === "win32"
      }
    );
    child.on("close", (exitCode) => {
      if (exitCode === 0) {
        resolve();
        return;
      }
      reject(new Error(`${workspace} ${script} failed with exit code ${exitCode ?? 1}`));
    });
  });
}

async function ensureInitialBuild() {
  const needsBuild = fresh || !fs.existsSync(mainDistEntry) || !fs.existsSync(coreDistEntry);
  if (!needsBuild) {
    console.log("[dev] dist ready, skipping initial build");
    return;
  }

  console.log("[dev] running initial build...");
  await runWorkspaceScript("@agent-resume/core", "build");
  await runWorkspaceScript("@agent-resume/desktop", "build");
}

function startWatchers() {
  spawnTracked(
    pnpmLauncher.command,
    [...pnpmLauncher.args, "--filter", "@agent-resume/core", "run", "watch"],
    { cwd: repoRoot, env: pnpmEnv }
  );
  spawnTracked(process.execPath, [tscBin, "-p", "tsconfig.json", "-w"], { cwd: root });
  spawnTracked(process.execPath, [path.join(root, "scripts", "watch-renderer.mjs")], { cwd: root });
}

function launchElectronOnce() {
  const electronPath = resolveElectronPath();
  return new Promise((resolve) => {
    const child = spawnTracked(electronPath, ["."], { cwd: root, env: devEnv() });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function launchElectronMon() {
  const electronmon = require("electronmon");
  const electronPath = resolveElectronPath();

  electronApp = await electronmon({
    cwd: root,
    args: ["."],
    env: devEnv(),
    electronPath,
    patterns: [
      "dist/main/**",
      "dist/preload/**",
      "dist/renderer/**",
      "../../packages/core/dist/**",
      "!dist/resources/**",
      "!src/**",
      "!../../packages/core/src/**",
      "!**/*.map"
    ]
  });
}

async function main() {
  ensureElectron();
  await ensureInitialBuild();

  if (noWatch) {
    const exitCode = await launchElectronOnce();
    shutdown(exitCode);
    return;
  }

  startWatchers();
  await launchElectronMon();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  shutdown(1);
});
