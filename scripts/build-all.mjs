import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  packageVsix,
  pruneProductionDependencies,
  syncDependenciesForPackaging,
} from "./vsix-output.mjs";

const root = join(import.meta.dirname, "..");
const manifestPath = join(root, "package.json");
const vscodeManifestPath = join(root, "package-vscode.json");

syncDependenciesForPackaging(root);

const original = readFileSync(manifestPath, "utf-8");
const pkg = JSON.parse(original);

// Compile TypeScript once before packaging
execSync("npm run compile", { cwd: root, stdio: "inherit" });

// Build Open VSX version (current package.json)
console.log("Building Open VSX version...");
const openvsxOut = packageVsix(`${pkg.name}-${pkg.version}.vsix`);

// Build VS Code Marketplace version (swap to package-vscode.json)
let vscodeOut;
try {
  console.log("Swapping manifest for VS Code Marketplace build...");
  const vscodeManifest = readFileSync(vscodeManifestPath, "utf-8");
  writeFileSync(manifestPath, vscodeManifest);

  const vscodePkg = JSON.parse(vscodeManifest);
  pruneProductionDependencies(root);

  console.log("Building VS Code Marketplace version...");
  vscodeOut = packageVsix(`${vscodePkg.name}-${vscodePkg.version}.vsix`);
} finally {
  // Always restore the original package.json and workspace dependency tree.
  writeFileSync(manifestPath, original);
  console.log("Restored original package.json.");
  syncDependenciesForPackaging(root);
}

console.log("\nBuild complete:");
console.log(`  Open VSX:             ${openvsxOut}`);
console.log(`  VS Code Marketplace:  ${vscodeOut}`);
console.log(`  Changelog:            ${join(root, "CHANGELOG.md")} (v${pkg.version})`);
console.log("\nPublish to Open VSX:");
console.log("  export OVSX_PAT=<your-token>");
console.log(`  npx ovsx publish ${openvsxOut}`);
console.log("  # or: npm run publish:openvsx");