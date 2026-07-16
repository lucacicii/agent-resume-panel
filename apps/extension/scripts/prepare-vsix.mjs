#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.join(scriptDir, "..");
const repoRoot = path.join(extensionRoot, "..", "..");
const coreDist = path.join(repoRoot, "packages", "core", "dist");
const targetRoot = path.join(extensionRoot, "node_modules", "@agent-resume", "core");

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

if (!fs.existsSync(coreDist)) {
  throw new Error(`Missing core build output: ${coreDist}. Run npm run build:core first.`);
}

fs.rmSync(path.join(extensionRoot, "node_modules"), { recursive: true, force: true });
fs.mkdirSync(targetRoot, { recursive: true });

const corePkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "packages", "core", "package.json"), "utf8"));
const vendoredCorePkg = {
  name: corePkg.name,
  version: corePkg.version,
  main: corePkg.main,
  types: corePkg.types,
  exports: corePkg.exports
};
fs.writeFileSync(path.join(targetRoot, "package.json"), `${JSON.stringify(vendoredCorePkg, null, 2)}\n`);
copyDir(coreDist, path.join(targetRoot, "dist"));

for (const dep of ["@agentclientprotocol/sdk", "dompurify", "marked", "zod"]) {
  const src = path.join(repoRoot, "node_modules", dep);
  const dest = path.join(extensionRoot, "node_modules", dep);
  if (!fs.existsSync(src)) {
    throw new Error(`Missing dependency: ${src}`);
  }
  fs.cpSync(src, dest, { recursive: true });
}

console.log("Prepared apps/extension/node_modules for VSIX packaging");
