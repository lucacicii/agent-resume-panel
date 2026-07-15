import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { packageVsix, syncDependenciesForPackaging } from "./vsix-output.mjs";

const root = join(import.meta.dirname, "..");

syncDependenciesForPackaging(root);
execSync("npm run compile", { cwd: root, stdio: "inherit" });

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));

console.log("Building Open VSX version...");
const outPath = packageVsix(`${pkg.name}-${pkg.version}.vsix`);

console.log(`\nPackaged: ${outPath}`);