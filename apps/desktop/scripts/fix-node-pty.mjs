import { chmodSync, existsSync, readdirSync, statSync } from "node:fs";
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

export function findSpawnHelpers(nodePtyRoot, platform = process.platform) {
  const helpers = [
    path.join(nodePtyRoot, "build", "Release", "spawn-helper"),
    path.join(nodePtyRoot, "build", "Debug", "spawn-helper")
  ];
  const prebuildsRoot = path.join(nodePtyRoot, "prebuilds");
  if (existsSync(prebuildsRoot)) {
    for (const entry of readdirSync(prebuildsRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith(`${platform}-`)) {
        helpers.push(path.join(prebuildsRoot, entry.name, "spawn-helper"));
      }
    }
  }
  return helpers;
}

export function ensureSpawnHelpersExecutable(nodePtyRoot, platform = process.platform) {
  return findSpawnHelpers(nodePtyRoot, platform).filter(ensureExecutable);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const nodePtyRoot = resolveNodePtyRoot();
  const helpers = ensureSpawnHelpersExecutable(nodePtyRoot);
  if (helpers.length === 0) {
    console.warn(`[fix-node-pty] no spawn-helper found for ${process.platform} under ${nodePtyRoot}`);
  }
}
