import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findAppBundle, needsRepack, packMacApp, runDesktopBuild } from "./mac-app.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function runRawElectron() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync("npx", ["electron", "."], {
    cwd: root,
    stdio: "inherit",
    env
  });
  process.exit(result.status ?? 1);
}

runDesktopBuild();

if (process.platform === "darwin") {
  const appBundle = needsRepack() ? packMacApp() : findAppBundle();
  if (!appBundle) throw new Error("Failed to locate Agent Resume.app");
  console.log(`Launching ${appBundle}`);
  spawnSync("open", [appBundle], { stdio: "inherit" });
} else {
  runRawElectron();
}