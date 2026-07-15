import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findAppBundle, needsRepack, packMacApp, runDesktopBuild } from "./mac-app.mjs";

if (process.platform !== "darwin") {
  console.error("dev:mac is only supported on macOS.");
  process.exit(1);
}

runDesktopBuild();

const appBundle = needsRepack() ? await packMacApp() : findAppBundle();
if (!appBundle) {
  throw new Error("Failed to locate Agent Resume.app");
}

console.log(`Launching ${appBundle}`);
const result = spawnSync("open", ["-n", appBundle], { stdio: "inherit" });
process.exit(result.status ?? 1);