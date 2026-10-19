/**
 * `pnpm run pack:desktop` — build the desktop app for the host platform.
 *
 * The platform-specific packers live in `apps/desktop/scripts/` (`pack-mac.mjs`,
 * `pack-win.mjs`) because each has its own signing, icon and installer
 * toolchain. This dispatcher only chooses the right one, so the command a user
 * learns works on both.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const script = process.platform === "win32" ? "pack-win.mjs" : "pack-mac.mjs";

if (process.platform !== "win32" && process.platform !== "darwin") {
  console.error(
    `Desktop packaging is supported on macOS and Windows; this host is ${process.platform}. ` +
      "Use a platform runner (see .github/workflows/desktop.yml)."
  );
  process.exit(1);
}

execFileSync(process.execPath, [path.join(root, "apps", "desktop", "scripts", script), ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit"
});
