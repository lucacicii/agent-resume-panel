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

function runCopy() {
  console.log("[watch-renderer] syncing renderer → dist/renderer");
  execFileSync(process.execPath, [copyScript, "--renderer-only"], { cwd: root, stdio: "inherit" });
}

function runReactBuild() {
  console.log("[watch-renderer] building React renderer runtime");
  execFileSync(process.execPath, [reactBuildScript], { cwd: root, stdio: "inherit" });
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
  runReactBuild();
});

console.log(`[watch-renderer] watching ${rendererSrc} and ${reactRendererSrc}`);
