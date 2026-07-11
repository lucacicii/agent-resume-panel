import { chmodSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolveNodePtyRoot() {
  try {
    return path.dirname(require.resolve("node-pty/package.json", { paths: [desktopRoot] }));
  } catch {
    return path.resolve(desktopRoot, "../../node_modules/node-pty");
  }
}

function ensureExecutable(filePath) {
  if (!existsSync(filePath)) return false;
  const mode = statSync(filePath).mode;
  if ((mode & 0o111) === 0) {
    chmodSync(filePath, mode | 0o755);
    console.log(`[fix-node-pty] chmod +x ${filePath}`);
  }
  return true;
}

const nodePtyRoot = resolveNodePtyRoot();
const helper = path.join(nodePtyRoot, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper");

if (ensureExecutable(helper)) {
  process.exit(0);
}

console.warn(`[fix-node-pty] spawn-helper not found at ${helper}`);
process.exit(0);