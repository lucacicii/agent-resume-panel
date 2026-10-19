/**
 * `pnpm run test:desktop` — run the desktop script/unit suites for this host.
 *
 * The suites are split by what they can actually assert: macOS packaging and
 * launchd are meaningless on Windows, and the Windows packaging suite needs a
 * Windows host. Everything platform-neutral runs everywhere.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopRoot = path.join(root, "apps", "desktop");

const COMMON = [
  "test:doctor",
  "test:workbench-files",
  "test:workbench-search",
  "test:workbench-replace",
  "test:agent-status",
  "test:node-pty",
  "test:thunder-sidecar"
];

const MAC = ["test:mac-app", "test:launchd"];
const WIN = ["test:win-app"];

const suites = [...COMMON, ...(process.platform === "win32" ? WIN : MAC)];

for (const suite of suites) {
  console.log(`\n▸ ${suite}`);
  execFileSync("pnpm", ["run", suite], {
    cwd: desktopRoot,
    stdio: "inherit",
    shell: process.platform === "win32"
  });
}

console.log(`\n${suites.length} desktop suites passed.`);
