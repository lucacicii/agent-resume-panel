import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { packageVsix } from "./vsix-output.mjs";

const extensionRoot = join(import.meta.dirname, "..");
const repoRoot = join(extensionRoot, "..", "..");

execSync("npm run compile", { cwd: repoRoot, stdio: "inherit" });

const openvsxPkg = JSON.parse(readFileSync(join(extensionRoot, "package.json"), "utf8"));
console.log("Building Open VSX version...");
const openvsxOut = packageVsix(`${openvsxPkg.name}-${openvsxPkg.version}.vsix`);

console.log("Building VS Code Marketplace version...");
execSync("node scripts/merge-extension-manifest.mjs --variant=marketplace", { cwd: extensionRoot, stdio: "inherit" });
const marketplacePkg = JSON.parse(readFileSync(join(extensionRoot, "package.json"), "utf8"));
const marketplaceOut = packageVsix(`${marketplacePkg.name}-${marketplacePkg.version}.vsix`);
execSync("node scripts/merge-extension-manifest.mjs", { cwd: extensionRoot, stdio: "inherit" });

console.log("\nBuild complete:");
console.log(`  Open VSX:             ${openvsxOut}`);
console.log(`  VS Code Marketplace:  ${marketplaceOut}`);
console.log(`  Changelog:            ${join(extensionRoot, "CHANGELOG.md")} (v${openvsxPkg.version})`);
console.log("\nPublish to Open VSX:");
console.log("  export OVSX_PAT=<your-token>");
console.log(`  npx ovsx publish ${openvsxOut}`);
console.log("  # or: npm run publish:openvsx");
