/**
 * `pnpm run reinstall` — remove every workspace `node_modules`, then reinstall.
 *
 * `rm -rf` does not exist on Windows, and even `rmdir /s /q` fails on locked
 * files. `fs.rmSync` handles both platforms, and the retry loop covers the
 * Windows case where a file watcher or antivirus scanner still holds a handle.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const targets = [path.join(root, "node_modules")];
for (const group of ["apps", "packages"]) {
  const groupRoot = path.join(root, group);
  if (!fs.existsSync(groupRoot)) continue;
  for (const entry of fs.readdirSync(groupRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    targets.push(path.join(groupRoot, entry.name, "node_modules"));
  }
}

const RETRY_DELAYS_MS = [50, 100, 250, 500, 1000];
for (const target of targets) {
  if (!fs.existsSync(target)) continue;
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      console.log(`removed ${path.relative(root, target)}`);
      break;
    } catch (error) {
      if (attempt >= RETRY_DELAYS_MS.length) throw error;
      const delay = RETRY_DELAYS_MS[attempt];
      console.warn(`retrying ${path.relative(root, target)} in ${delay}ms: ${error.message}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
    }
  }
}

execFileSync("pnpm", ["install"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32"
});
