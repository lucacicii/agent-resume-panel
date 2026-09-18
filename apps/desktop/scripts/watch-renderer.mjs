import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const rendererSrc = path.join(root, "src", "renderer");
const reactRendererSrc = path.join(root, "src", "renderer-react");
const copyScript = path.join(root, "scripts", "copy-renderer.cjs");
const reactBuildScript = path.join(root, "scripts", "build-renderer-react.mjs");

let debounceTimer = null;
/**
 * A build takes ~600ms and blocks this process, so events that arrive meanwhile
 * queue up behind it. Coalescing turns a burst (a branch switch touches every
 * file) into one build instead of one build per event, which is what made
 * packaging look like a loop while the watchers were running.
 */
const REACT_BUILD_DEBOUNCE_MS = 250;
let reactBuildTimer = null;
let reactBuildRunning = false;
let reactBuildPending = false;

function runCopy() {
  console.log("[watch-renderer] syncing renderer → dist/renderer");
  try {
    execFileSync(process.execPath, [copyScript, "--renderer-only"], { cwd: root, stdio: "inherit" });
  } catch (error) {
    console.error("[watch-renderer] renderer copy failed (keeping watch alive):", error.message);
  }
}

function buildReactOnce() {
  if (reactBuildRunning) {
    reactBuildPending = true;
    return;
  }
  reactBuildRunning = true;
  try {
    console.log("[watch-renderer] building React renderer runtime");
    execFileSync(process.execPath, [reactBuildScript], { cwd: root, stdio: "inherit" });
  } catch (error) {
    console.error("[watch-renderer] React renderer build failed (keeping watch alive):", error.message);
    if (error && typeof error === "object" && "stderr" in error && Buffer.isBuffer(error.stderr)) {
      console.error(error.stderr.toString());
    }
  } finally {
    reactBuildRunning = false;
  }
  if (reactBuildPending) {
    reactBuildPending = false;
    scheduleReactBuild();
  }
}

function scheduleReactBuild() {
  if (reactBuildTimer) clearTimeout(reactBuildTimer);
  reactBuildTimer = setTimeout(() => {
    reactBuildTimer = null;
    buildReactOnce();
  }, REACT_BUILD_DEBOUNCE_MS);
}

function scheduleCopy() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    runCopy();
  }, 200);
}

if (!fs.existsSync(rendererSrc)) {
  console.error(`[watch-renderer] missing source directory: ${rendererSrc}`);
  process.exit(1);
}
if (!fs.existsSync(reactRendererSrc)) {
  console.error(`[watch-renderer] missing React renderer directory: ${reactRendererSrc}`);
  process.exit(1);
}

fs.watch(rendererSrc, { recursive: true }, () => {
  scheduleCopy();
});

fs.watch(reactRendererSrc, { recursive: true }, () => {
  scheduleReactBuild();
});

console.log(`[watch-renderer] watching ${rendererSrc} and ${reactRendererSrc}`);
