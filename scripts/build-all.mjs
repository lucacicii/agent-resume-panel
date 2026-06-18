import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

import { execSync } from "node:child_process";
const root = join(import.meta.dirname, "..");
const distDir = join(root, "dist");
const manifestPath = join(root, "package.json");
const vscodeManifestPath = join(root, "package-vscode.json");

const original = readFileSync(manifestPath, "utf-8");
const pkg = JSON.parse(original);

mkdirSync(distDir, { recursive: true });

// Compile TypeScript once before packaging
execSync("npm run compile", { cwd: root, stdio: "inherit" });

function vscePackage(outName) {
  const outPath = join(distDir, outName);
  execFileSync("npx", ["vsce", "package", "--no-dependencies", "-o", outPath], {
    cwd: root,
    stdio: "inherit",
  });
  return outPath;
}

// Build Open VSX version (current package.json)
console.log("Building Open VSX version...");
const openvsxOut = vscePackage(`${pkg.name}-${pkg.version}.vsix`);

// Build VS Code Marketplace version (swap to package-vscode.json)
let vscodeOut;
try {
  console.log("Swapping manifest for VS Code Marketplace build...");
  const vscodeManifest = readFileSync(vscodeManifestPath, "utf-8");
  writeFileSync(manifestPath, vscodeManifest);

  const vscodePkg = JSON.parse(vscodeManifest);
  console.log("Building VS Code Marketplace version...");
  vscodeOut = vscePackage(`${vscodePkg.name}-${vscodePkg.version}.vsix`);
} finally {
  // Always restore the original package.json
  writeFileSync(manifestPath, original);
  console.log("Restored original package.json.");
}

console.log("\nBuild complete:");
console.log(`  Open VSX:             ${openvsxOut}`);
console.log(`  VS Code Marketplace:  ${vscodeOut}`);
