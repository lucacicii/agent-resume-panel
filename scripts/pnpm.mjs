import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const localBinDir = path.join(scriptDir, "bin");
const corepackName = process.platform === "win32" ? "corepack.cmd" : "corepack";
const corepackBin = path.join(path.dirname(process.execPath), corepackName);
let command = fs.existsSync(corepackBin) ? corepackBin : "corepack";
let commandArgs = ["pnpm"];

if (process.platform === "win32") {
  const corepackEntry = path.join(
    path.dirname(process.execPath),
    "node_modules",
    "corepack",
    "dist",
    "corepack.js"
  );
  if (!fs.existsSync(corepackEntry)) {
    throw new Error(`Unable to find the Corepack entry point at ${corepackEntry}`);
  }
  command = process.execPath;
  commandArgs = [corepackEntry, "pnpm"];
}

const currentPath = process.env.PATH ?? "";
const env = {
  ...process.env,
  PATH: `${localBinDir}${path.delimiter}${currentPath}`,
  PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN:
    process.env.PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN ?? "false"
};

const child = spawn(command, [...commandArgs, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env,
  stdio: "inherit",
  shell: false
});

child.on("error", (error) => {
  console.error(`Failed to start Corepack pnpm: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
