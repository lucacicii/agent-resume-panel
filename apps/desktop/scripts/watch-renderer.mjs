import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const rendererSrc = path.join(root, "src", "renderer");
const copyScript = path.join(root, "scripts", "copy-renderer.cjs");

let debounceTimer = null;

function runCopy() {
  console.log("[watch-renderer] syncing renderer → dist/renderer");
  execFileSync(process.execPath, [copyScript, "--renderer-only"], { cwd: root, stdio: "inherit" });
}

function scheduleCopy(filename) {
  if (filename) {
    const norm = filename.replace(/\\/g, "/");
    if (norm.startsWith("vendor-entry/") || norm.includes("/vendor-entry/")) {
      return;
    }
  }
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

fs.watch(rendererSrc, { recursive: true }, (_event, filename) => {
  scheduleCopy(filename);
});

console.log(`[watch-renderer] watching ${rendererSrc}`);